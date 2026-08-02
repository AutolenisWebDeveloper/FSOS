import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { sendThroughGate } from '@/lib/comms/send'
import { runIdempotent } from '@/lib/jobs/runtime'
import { getOrCreateConversation } from '@/lib/comms/conversations'
import { resolveAssetPayload } from '@/lib/comms/assets'
import { canInitiateAiConversation, openerClassFor, isManualPurposeAllowed } from '@/lib/comms/console'
import { MESSAGE_PURPOSES, type MessagePurpose } from '@/lib/comms/purpose'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Communications Command Console — B1: initiate an OUTBOUND AI conversation with a chosen
// agent (spec §4). Conversations exist today only from inbound; this is the initiator.
// Flow (spec §B1): resolve/create the thread → verify the agent is enabled + not the
// guardrail + the contact is not securities-flagged (firewall §4.1) → build the opening
// turn from a seed asset or a blank opener → send it through sendThroughGate() (the SAME
// 7-step gate; the opener is aiGenerated so the AI-authority matrix + §12 evaluations run)
// → on success arm ai_autoreply and bind agent_key/origin; on block, the thread is NOT
// armed and the reason is surfaced. There is no bypass.
const StartSchema = z.object({
  agent_key: z.string().min(1).max(80),
  channel: z.enum(['sms', 'email']),
  to: z.string().min(3),
  subject: z.string().max(200).optional(),
  member_id: z.string().uuid().optional(),
  household_id: z.string().uuid().optional(),
  seed_asset_id: z.string().uuid().optional(),
  seed_asset_table: z.string().max(80).optional(),
  opening_body: z.string().min(1).max(4000).optional(),
  purpose: z.enum(MESSAGE_PURPOSES as [string, ...string[]]).default('RELATIONSHIP'),
  idempotency_key: z.string().min(8).max(200),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = StartSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })
  const d = v.data

  if (!isManualPurposeAllowed(d.purpose)) {
    return NextResponse.json({ error: 'That purpose is not available for an initiated conversation.', reason: 'purpose_not_allowed' }, { status: 422 })
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // The chosen agent must exist, be enabled, and NOT be the guardrail (system agent).
    const { data: agent } = await db.from('ai_agents').select('key, name, enabled, is_guardrail').eq('key', d.agent_key).maybeSingle()
    if (!agent) return NextResponse.json({ error: 'Unknown agent.', reason: 'agent_not_found' }, { status: 404 })

    // Resolve/create the ONE thread for (channel, contact) — also gives the server-derived
    // securities-firewall flag we must not bypass.
    const conv = await getOrCreateConversation(d.channel, d.to)
    if (!conv) return NextResponse.json({ error: 'Could not resolve a conversation for that contact.', reason: 'no_conversation' }, { status: 400 })

    const eligibility = canInitiateAiConversation({
      isSecurity: conv.is_security === true,
      agentEnabled: agent.enabled === true,
      isGuardrail: agent.is_guardrail === true,
    })
    if (!eligibility.allowed) {
      await writeAudit({ actor, action: 'ai.escalated', entity: 'comm_conversation', entityId: conv.id, diff: { blocked: 'ai_initiation', reason: eligibility.reason, agent: d.agent_key } })
      return NextResponse.json({ ok: false, blocked: true, reason: eligibility.reason }, { status: 200 })
    }

    // Build the opening turn: from a seed asset (approved-template first touch) or a blank
    // opener (availability question). Both classes are green-zone auto-send (ai-authority).
    let openingBody = d.opening_body ?? ''
    let templateId: string | null = null
    let seededFrom: 'approved_template' | 'blank' = 'blank'
    let sourceCampaignKey: string | null = null
    let sourceAssetId: string | null = null
    let sourceAssetTable: string | null = null
    if (d.seed_asset_id && d.seed_asset_table) {
      const asset = await resolveAssetPayload(d.seed_asset_id, d.seed_asset_table)
      if (!asset) return NextResponse.json({ error: 'Seed asset could not be resolved.', reason: 'asset_not_found' }, { status: 404 })
      if (asset.channel !== d.channel) return NextResponse.json({ error: 'Seed asset is not for this channel.', reason: 'channel_mismatch' }, { status: 422 })
      openingBody = asset.body
      templateId = asset.templateId
      seededFrom = 'approved_template'
      sourceCampaignKey = asset.campaignKey
      sourceAssetId = asset.assetId
      sourceAssetTable = asset.sourceTable
    }
    if (!openingBody.trim()) return NextResponse.json({ error: 'An opening message (seed asset or opener) is required.', reason: 'no_opener' }, { status: 400 })

    // Bind the agent + mark origin for a FRESH thread (never relabel an active inbound one).
    const originPatch: Record<string, unknown> = { agent_key: d.agent_key, updated_at: new Date().toISOString() }
    const { data: convRow } = await db.from('comm_conversations').select('last_message_at, origin').eq('id', conv.id).maybeSingle()
    if (!convRow?.last_message_at) originPatch.origin = 'outbound_manual'
    await db.from('comm_conversations').update(originPatch).eq('id', conv.id)

    // Send the opener through the gate (aiGenerated → AI-authority matrix + §12 evals run).
    const outcome = await runIdempotent(`conv-start:${d.idempotency_key}`, 'comms.conversation.start', async () =>
      sendThroughGate({
        channel: d.channel,
        to: d.to,
        subject: d.subject,
        body: openingBody,
        actor,
        memberId: d.member_id ?? conv.member_id ?? null,
        householdId: d.household_id ?? conv.household_id ?? null,
        conversationId: conv.id,
        templateId,
        aiGenerated: true,
        aiAuthorAgentKey: d.agent_key,
        aiMessageClass: openerClassFor(seededFrom),
        // Operator-initiated individual AI conversation — consent-on-file is waived (ADR-033).
        // Opt-out-safe (an explicit revoke still blocks) and the opener still clears the AI-
        // authority matrix + DNC/quiet-hours/securities/recommendation gate steps.
        consentWaived: true,
        purpose: d.purpose as MessagePurpose,
        sourceKind: 'agent_seed',
        sourceCampaignKey,
        sourceAssetId,
        sourceAssetTable,
        entity: { type: 'conversation', id: conv.id },
      }),
    )
    if (outcome.skipped) return NextResponse.json({ ok: true, idempotent: true })
    const r = outcome.result!

    if (r.blocked) {
      // Opener blocked → thread NOT armed. Surface the failing step/reason.
      return NextResponse.json({ ok: false, blocked: true, reason: r.reason, blocked_step: r.gate.blockedStep, conversation_id: conv.id }, { status: 200 })
    }

    // Opener sent → arm per-thread AI auto-reply (governed by ai-authority on each reply).
    await db.from('comm_conversations').update({ ai_autoreply: true, updated_at: new Date().toISOString() }).eq('id', conv.id)
    await writeAudit({ actor, action: 'ai.action', entity: 'comm_conversation', entityId: conv.id, diff: { initiated: true, agent: d.agent_key, channel: d.channel, seeded_from: seededFrom } })
    return NextResponse.json({ ok: true, sent: true, conversation_id: conv.id, message_id: r.messageId, ai_autoreply: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to initiate conversation' }, { status: 500 })
  }
}
