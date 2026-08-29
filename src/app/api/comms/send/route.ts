import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { sendThroughGate } from '@/lib/comms/send'
import { runIdempotent } from '@/lib/jobs/runtime'
import { isManualPurposeAllowed } from '@/lib/comms/console'
import { resolveAssetPayload, adHocTemplateId } from '@/lib/comms/assets'
import { MESSAGE_PURPOSES, isMarketingPurpose, type MessagePurpose } from '@/lib/comms/purpose'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-12 one-off send (inbox reply / manual) + Communications Command Console individual
// SMS/email (spec §4). ALWAYS through the 7-step gate at send time. Idempotency key
// prevents double-sends on retry. There is no force-send path (spec §0).
//
// The console extends the INPUTS only — the send path is unchanged:
//   • blank compose         → operator-typed body, human_authored, ad-hoc APPROVED template
//                             resolves gate step 4 + the email footer.
//   • from a campaign asset → source_asset_id/table; the body + approved template are
//                             RE-RESOLVED server-side from the catalog (spec §B2), so the
//                             asset is sent faithfully and the client body is not trusted.
// is_test is deliberately NOT accepted here: a test send must go through POST /api/comms/test
// (verified-self allowlist, spec §6). This route can never mark a live send as a test.
const SendSchema = z.object({
  channel: z.enum(['sms', 'email']),
  to: z.string().min(3),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(4000).optional(),
  member_id: z.string().uuid().optional(),
  household_id: z.string().uuid().optional(),
  template_id: z.string().uuid().optional(),
  entity_type: z.string().max(60).optional(),
  entity_id: z.string().uuid().optional(),
  is_security: z.boolean().optional(),
  // Console provenance (spec §3.1). Descriptive only; never affects the gate.
  source_kind: z.enum(['blank', 'campaign_asset']).optional(),
  source_asset_id: z.string().uuid().optional(),
  source_asset_table: z.string().max(80).optional(),
  purpose: z.enum(MESSAGE_PURPOSES as [string, ...string[]]).optional(),
  human_authored: z.boolean().optional(),
  idempotency_key: z.string().min(8).max(200),
})

// CAN-SPAM footer appended to a BLANK operator email so {{unsubscribe_url}} resolves to the
// enforced per-recipient opt-out link (mirrors the seeded ad-hoc email template, mig 087).
const EMAIL_ADHOC_FOOTER =
  '\n\n<hr/><p style="font-size:12px;color:#666">You are receiving this because you are a client or contact of your Farmers Financial Services agent. <a href="{{unsubscribe_url}}">Unsubscribe</a>.</p>'

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = SendSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid send', details: v.error.flatten() }, { status: 400 })
  const d = v.data

  // A purpose, if supplied, must be one a licensed operator may attach to a 1:1 send (§12.1).
  if (d.purpose && !isManualPurposeAllowed(d.purpose)) {
    return NextResponse.json({ error: 'That purpose is not available for an individual send.', reason: 'purpose_not_allowed' }, { status: 422 })
  }

  try {
    const actor = actorOf(auth.session)

    // Resolve the message content + gate handle.
    let channel = d.channel
    let body = d.body ?? ''
    let subject = d.subject
    let templateId: string | null = d.template_id ?? null
    let sourceKind: 'blank' | 'campaign_asset' | 'agent_seed' | 'test' = d.source_kind ?? 'blank'
    let sourceCampaignKey: string | null = null
    let sourceAssetId: string | null = null
    let sourceAssetTable: string | null = null
    let humanAuthored = d.human_authored === true

    if (d.source_kind === 'campaign_asset' && d.source_asset_id && d.source_asset_table) {
      // Re-resolve the asset server-side (spec §B2) — the operator cannot substitute a body.
      const asset = await resolveAssetPayload(d.source_asset_id, d.source_asset_table)
      if (!asset) return NextResponse.json({ error: 'Selected asset could not be resolved.', reason: 'asset_not_found' }, { status: 404 })
      if (asset.channel !== d.channel) {
        return NextResponse.json({ error: 'Selected asset is not for this channel.', reason: 'channel_mismatch' }, { status: 422 })
      }
      channel = asset.channel
      body = asset.body
      subject = asset.subject ?? d.subject
      templateId = asset.templateId
      sourceKind = 'campaign_asset'
      sourceCampaignKey = asset.campaignKey
      sourceAssetId = asset.assetId
      sourceAssetTable = asset.sourceTable
      humanAuthored = false // an approved campaign template satisfies gate step 4
    } else {
      // Blank compose (or a legacy caller passing an explicit template). A licensed operator
      // typing a 1:1 message IS the content approval (send.ts humanAuthored); when no template
      // is supplied, resolve the designated ad-hoc APPROVED template so gate step 4 + the email
      // footer resolve (spec §5). Recommendation language is still hard-blocked at gate step 5.
      if (!body.trim()) return NextResponse.json({ error: 'Message body is required.', reason: 'empty_body' }, { status: 400 })
      if (!templateId) {
        templateId = await adHocTemplateId(d.channel)
        if (!templateId) {
          return NextResponse.json({ error: 'No approved template available for this send.', reason: 'no_template' }, { status: 422 })
        }
        humanAuthored = true
        if (d.channel === 'email') body = body + EMAIL_ADHOC_FOOTER
      }
    }

    const outcome = await runIdempotent(`send:${d.idempotency_key}`, 'comms.send', async () =>
      sendThroughGate({
        channel,
        to: d.to,
        subject,
        body,
        actor,
        memberId: d.member_id ?? null,
        householdId: d.household_id ?? null,
        entity: d.entity_type && d.entity_id ? { type: d.entity_type, id: d.entity_id } : undefined,
        templateId,
        isSecurity: d.is_security === true,
        humanAuthored,
        // Individual 1:1 operator send — consent-on-file is waived (ADR-033). Opt-out-safe:
        // an explicit revoke still blocks, and DNC/quiet-hours/securities/recommendation all
        // still apply. WS-036: the waiver is for 1:1 SERVICING — it never stacks with a
        // caller-declared MARKETING-class purpose (MARKETING/WORKSHOP), which must clear the
        // real consent gate like any other marketing send.
        consentWaived: !(d.purpose && isMarketingPurpose(d.purpose as MessagePurpose)),
        purpose: d.purpose as MessagePurpose | undefined,
        sourceKind,
        sourceCampaignKey,
        sourceAssetId,
        sourceAssetTable,
      }),
    )
    if (outcome.skipped) return NextResponse.json({ ok: true, idempotent: true })
    const r = outcome.result!
    if (r.blocked) return NextResponse.json({ ok: false, blocked: true, reason: r.reason, blocked_step: r.gate.blockedStep }, { status: 200 })
    return NextResponse.json({ ok: true, sent: true, message_id: r.messageId })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
