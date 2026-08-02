import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { sendThroughGate } from '@/lib/comms/send'
import { runIdempotent } from '@/lib/jobs/runtime'
import { resolveAssetPayload, adHocTemplateId } from '@/lib/comms/assets'
import { isTestRecipientUsable, openerClassFor } from '@/lib/comms/console'
import { evaluateOutboundMessage } from '@/lib/comms/evaluations'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Communications Command Console — B4: per-campaign TEST send (spec §6). A test is a REAL
// send through the production 7-step gate to a VERIFIED destination the operator OWNS — it
// proves the whole pipeline, not a mock. It NEVER: enrolls, advances, touches production
// analytics (rows are is_test=true), reaches a non-allowlisted address, or bypasses the
// gate/consent/quiet-hours/STOP/AI-authority. The result surfaces the gate outcome so the
// operator can confirm "this campaign's SMS/email/AI is working and will send."
const TestSchema = z.object({
  channel: z.enum(['sms', 'email']),
  test_recipient_id: z.string().uuid(),
  campaign_key: z.string().max(80).optional(),
  asset_id: z.string().uuid().optional(),
  asset_table: z.string().max(80).optional(),
  body: z.string().max(4000).optional(),
  // AI test: run the opener through the sandbox; optionally also live-send it to self.
  agent_key: z.string().max(80).optional(),
  live_ai: z.boolean().optional(),
  idempotency_key: z.string().min(8).max(200),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = TestSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid test request', details: v.error.flatten() }, { status: 400 })
  const d = v.data

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // The destination MUST be a verified allowlisted destination this operator owns (spec §6).
    const { data: recipient } = await db
      .from('comms_test_recipients')
      .select('id, user_id, channel, address, verified_at')
      .eq('id', d.test_recipient_id)
      .maybeSingle()
    if (!isTestRecipientUsable(recipient, actor)) {
      return NextResponse.json({ error: 'That test destination is not verified or not yours. Add and verify a destination first.', reason: 'test_recipient_invalid' }, { status: 422 })
    }
    if (recipient!.channel !== d.channel) {
      return NextResponse.json({ error: 'That test destination is for a different channel.', reason: 'channel_mismatch' }, { status: 422 })
    }
    const to = recipient!.address as string

    // Resolve the asset (if any) — the campaign's ACTUAL asset, rendered through production.
    const asset = d.asset_id && d.asset_table ? await resolveAssetPayload(d.asset_id, d.asset_table) : null
    if (d.asset_id && !asset) return NextResponse.json({ error: 'Selected asset could not be resolved.', reason: 'asset_not_found' }, { status: 404 })

    // ── AI test: run the opener through the sandbox (ai_sandbox_runs), guardrail-evaluated.
    if (d.agent_key) {
      const opener = asset?.body ?? d.body ?? 'Hi — this is a quick note from your Farmers Financial Services agent. Would you be open to a brief conversation?'
      const evalResult = evaluateOutboundMessage({
        draft: opener,
        messageClass: openerClassFor(asset ? 'approved_template' : 'blank'),
        purposeClassified: true,
        ownershipResolved: true,
        identityDisclosureSatisfied: true,
        consentCompatible: true,
        templateApproved: true,
      })
      const guardrailPass = evalResult.pass
      await db.from('ai_sandbox_runs').insert({
        agent_key: d.agent_key,
        prompt: opener,
        input: { campaign_key: d.campaign_key ?? null, asset_id: d.asset_id ?? null, is_test: true },
        output: opener,
        guardrail_pass: guardrailPass,
        guardrail_reason: evalResult.failures.join(',') || null,
        blocked: !guardrailPass,
        created_by: actor,
      })

      // Optional live AI test to self (opt-in only, allowlisted destination).
      let live: { sent: boolean; blocked: boolean; blocked_step?: string; reason?: string; message_id?: string } | undefined
      if (d.live_ai) {
        const outcome = await runIdempotent(`test-ai:${d.idempotency_key}`, 'comms.test.ai', async () =>
          sendThroughGate({
            channel: d.channel,
            to,
            subject: asset?.subject ?? undefined,
            body: opener,
            actor,
            templateId: asset?.templateId ?? null,
            aiGenerated: true,
            aiAuthorAgentKey: d.agent_key,
            aiMessageClass: openerClassFor(asset ? 'approved_template' : 'blank'),
            purpose: 'RELATIONSHIP',
            // A test to a destination the operator OWNS and verified needs no consent-on-file
            // (ADR-033) — you don't consent to yourself. Every other gate step still runs.
            consentWaived: true,
            isTest: true,
            sourceKind: 'test',
            sourceCampaignKey: d.campaign_key ?? null,
            sourceAssetId: asset?.assetId ?? null,
            sourceAssetTable: asset?.sourceTable ?? null,
          }),
        )
        if (!outcome.skipped) {
          const r = outcome.result!
          live = { sent: r.sent, blocked: r.blocked, blocked_step: r.gate.blockedStep, reason: r.reason, message_id: r.messageId }
        }
      }
      await writeAudit({ actor, action: 'ai.run', entity: 'ai_sandbox_run', entityId: recipient!.id, diff: { campaign: d.campaign_key ?? null, agent: d.agent_key, guardrail_pass: guardrailPass, live: !!d.live_ai } })
      return NextResponse.json({ ok: true, ai_test: true, guardrail_pass: guardrailPass, failures: evalResult.failures, authority: evalResult.authority, output: opener, live })
    }

    // ── Email/SMS test: dispatch the campaign's asset (or a blank body) through the gate.
    const body = asset?.body ?? d.body ?? ''
    let templateId = asset?.templateId ?? null
    let humanAuthored = false
    if (!asset) {
      if (!body.trim()) return NextResponse.json({ error: 'Provide an asset or a body to test.', reason: 'empty' }, { status: 400 })
      templateId = await adHocTemplateId(d.channel)
      if (!templateId) return NextResponse.json({ error: 'No approved template available for the test.', reason: 'no_template' }, { status: 422 })
      humanAuthored = true
    }

    const outcome = await runIdempotent(`test:${d.idempotency_key}`, 'comms.test', async () =>
      sendThroughGate({
        channel: d.channel,
        to,
        subject: asset?.subject ?? undefined,
        body,
        actor,
        templateId,
        humanAuthored,
        // Verified-self test destination — consent-on-file is waived (ADR-033). Opt-out-safe;
        // quiet-hours/DNC/securities/recommendation/A2P still apply exactly as for a live send.
        consentWaived: true,
        isTest: true,
        sourceKind: 'test',
        sourceCampaignKey: d.campaign_key ?? null,
        sourceAssetId: asset?.assetId ?? null,
        sourceAssetTable: asset?.sourceTable ?? null,
      }),
    )
    if (outcome.skipped) return NextResponse.json({ ok: true, idempotent: true })
    const r = outcome.result!
    await writeAudit({ actor, action: 'comms.sent', entity: 'comms_test', entityId: recipient!.id, diff: { campaign: d.campaign_key ?? null, asset: d.asset_id ?? null, sent: r.sent, blocked_step: r.gate.blockedStep ?? null } })
    return NextResponse.json({
      ok: true,
      test: true,
      sent: r.sent,
      blocked: r.blocked,
      blocked_step: r.gate.blockedStep,
      reason: r.reason,
      message_id: r.messageId,
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to run test' }, { status: 500 })
  }
}
