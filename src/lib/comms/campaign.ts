// src/lib/comms/campaign.ts
// Campaign dispatch. Iterates a campaign's audience and, FOR EACH recipient, runs
// the 7-step gate at send time via sendThroughGate(): consent, quiet-hours, DNC,
// approved template, recommendation, is_security, other rule. Pass → send; fail →
// suppressed + reason recorded + escalated (never silently dropped). No bypass.
//
// Supports:
//   • audience segmentation (all_consented | household_ids | cross_sell | conversion),
//   • A/B variants (weighted split across approved templates + optional subjects),
//   • merge-token personalization per recipient,
//   • broadcast (one send) and drip (multi-step sequence) campaign types.
// Used by the activate API and the campaign-dispatch cron job.
import { getDb } from '@/lib/supabase/client'
import { sendThroughGate } from './send'
import { isTemplateApproved } from './send'
import { writeAudit } from '@/lib/audit/log'
import type { RecipientContext } from './personalize'
import type { MessagePurpose } from './purpose'
import { campaignSendConfig, delegationSendContext } from './campaign-config'
import { campaignClaimKeys, buildDataConfidence } from './claims'
import { resolveClaimFields } from './claim-resolver'

export interface DispatchCounts {
  audience: number
  sent: number
  suppressed: number
  blocked: number
}

interface Recipient {
  member_id: string
  household_id: string
  agency_id: string | null
  email: string | null
  phone: string | null
  full_name: string | null
}

interface Variant {
  key: string
  template_id: string
  subject?: string
  weight: number
}

export async function resolveAudience(campaign: { channel: string; audience: { kind?: string; household_ids?: string[] } }): Promise<Recipient[]> {
  const db = getDb()
  const kind = campaign.audience?.kind ?? 'all_consented'
  const channel = campaign.channel as 'sms' | 'email'

  let householdIds: string[] | null = null
  if (kind === 'household_ids' && Array.isArray(campaign.audience?.household_ids)) {
    householdIds = campaign.audience.household_ids
  } else if (kind === 'cross_sell') {
    const { data } = await db.from('v_cross_sell_gaps').select('household_id').limit(2000)
    householdIds = (data ?? []).map((r: { household_id: string }) => r.household_id)
  } else if (kind === 'conversion') {
    const { data } = await db.from('v_conversions_due').select('household_id').eq('is_security', false).limit(2000)
    householdIds = (data ?? []).map((r: { household_id: string }) => r.household_id)
  }

  let q = db
    .from('household_members')
    .select('id, household_id, email, phone, full_name, households!inner(do_not_contact, deleted_at, referring_agency_id)')
    .is('households.deleted_at', null)
    .eq('households.do_not_contact', false)
    .limit(5000)
  if (householdIds) {
    if (householdIds.length === 0) return []
    q = q.in('household_id', householdIds)
  }
  const { data } = await q
  const rows = (data ?? []) as unknown as {
    id: string
    household_id: string
    email: string | null
    phone: string | null
    full_name: string | null
    households: { referring_agency_id: string | null } | null
  }[]
  return rows
    .map((r) => ({
      member_id: r.id,
      household_id: r.household_id,
      agency_id: r.households?.referring_agency_id ?? null,
      email: r.email,
      phone: r.phone,
      full_name: r.full_name,
    }))
    .filter((r) => (channel === 'email' ? !!r.email : !!r.phone))
}

// Deterministic weighted variant pick keyed on the member id, so a given recipient
// always lands in the same A/B bucket (stable across retries) without RNG.
function pickVariant(variants: Variant[], memberId: string): Variant {
  const total = variants.reduce((s, v) => s + Math.max(1, v.weight), 0)
  let hash = 0
  for (let i = 0; i < memberId.length; i++) hash = (hash * 31 + memberId.charCodeAt(i)) >>> 0
  let target = hash % total
  for (const v of variants) {
    target -= Math.max(1, v.weight)
    if (target < 0) return v
  }
  return variants[0]
}

export async function templateBody(templateId: string): Promise<string> {
  const { data } = await getDb().from('comm_templates').select('body').eq('id', templateId).maybeSingle()
  return data?.body ?? ''
}

/** The campaign-level send config (purpose + delegated-sender) the gate reads (Slice 7). */
export interface CampaignDispatchContext {
  purpose?: MessagePurpose
  delegation?: { agencyId: string; campaignType?: string | null; senderUserId?: string | null }
  ownership?: { representedAgencyId?: string | null; representedAgencyOwnerId?: string | null; delegationId?: string | null }
}

/**
 * Resolve the campaign-level dispatch context ONCE per campaign (Slice 7, §7/§9/§10):
 *  • purpose — from the campaign, falling back to the drip sequence's default purpose;
 *  • delegated-sender — for an on-behalf-of campaign, load the delegation row to attribute
 *    the represented agency/owner + the actual sender. The delegation's ACTIVE/in-scope
 *    status is re-checked FRESH per send by the gate (send.ts → resolveDelegation); this
 *    only supplies the identifying context. A missing/deleted delegation degrades safely to
 *    a non-delegated send (represented agency = the recipient's referring agency).
 */
export async function campaignDispatchContext(campaign: {
  id: string
  type?: string | null
  purpose?: string | null
  delegation_id?: string | null
  represented_agency_owner_id?: string | null
  sequencePurpose?: string | null
}): Promise<CampaignDispatchContext> {
  const cfg = campaignSendConfig({
    purpose: campaign.purpose ?? campaign.sequencePurpose ?? null,
    delegation_id: campaign.delegation_id,
    represented_agency_owner_id: campaign.represented_agency_owner_id,
  })
  const ctx: CampaignDispatchContext = { purpose: cfg.purpose }
  if (cfg.delegated && cfg.delegationId && cfg.representedAgencyOwnerId) {
    const { data: del } = await getDb()
      .from('agency_communication_delegations')
      .select('id, agency_id, representative_user_id')
      .eq('id', cfg.delegationId)
      .maybeSingle()
    if (del) {
      const built = delegationSendContext(
        {
          agencyId: del.agency_id,
          representativeUserId: del.representative_user_id ?? null,
          representedAgencyOwnerId: cfg.representedAgencyOwnerId,
          delegationId: del.id,
        },
        { campaignType: campaign.type ?? null },
      )
      ctx.delegation = built.delegation
      ctx.ownership = built.ownership
    }
  }
  return ctx
}

function recipientContext(r: Recipient): RecipientContext {
  return { full_name: r.full_name }
}

/** Dispatch a broadcast campaign through the gate. Idempotent per (campaign, member). */
export async function dispatchCampaign(campaignId: string, actor: string): Promise<DispatchCounts | { error: string }> {
  const db = getDb()
  const { data: campaign } = await db.from('comm_campaigns').select('*').eq('id', campaignId).maybeSingle()
  if (!campaign) return { error: 'Campaign not found' }
  if (campaign.type === 'drip') return dispatchDripEnroll(campaign, actor)

  // Build the variant set: A/B variants if enabled, else the single campaign template.
  const rawVariants = Array.isArray(campaign.variants) ? (campaign.variants as Variant[]) : []
  const variants: Variant[] =
    campaign.ab_enabled && rawVariants.length > 0
      ? rawVariants
      : [{ key: 'A', template_id: campaign.template_id, subject: campaign.subject ?? undefined, weight: 1 }]

  // Every variant template must be approved at dispatch time.
  for (const v of variants) {
    if (!(await isTemplateApproved(v.template_id))) return { error: `Campaign variant "${v.key}" template is not approved.` }
  }
  // Pre-load bodies (+ the stored plaintext part, Slice 9B) once.
  const bodies = new Map<string, { body: string; bodyText: string | null }>()
  for (const v of variants) {
    const { data } = await getDb().from('comm_templates').select('body, body_text').eq('id', v.template_id).maybeSingle()
    bodies.set(v.template_id, { body: data?.body ?? '', bodyText: (data?.body_text as string | null) ?? null })
  }

  const channel = campaign.channel as 'sms' | 'email'
  const audience = await resolveAudience(campaign)
  const counts: DispatchCounts = { audience: audience.length, sent: 0, suppressed: 0, blocked: 0 }

  // Slice 7 — resolve the campaign-level purpose + delegated-sender context ONCE.
  const campCtx = await campaignDispatchContext(campaign)
  // Slice 8 §18 — declared specific-claim fields (resolved per recipient below).
  const declaredClaims = campaignClaimKeys(campaign.claim_fields)

  for (const r of audience) {
    const to = channel === 'email' ? r.email! : r.phone!
    const variant = pickVariant(variants, r.member_id)

    // Idempotent enrollment: a unique (campaign_id, member_id) prevents double-send.
    const { error: enrollErr } = await db
      .from('comm_campaign_enrollments')
      .insert({ campaign_id: campaignId, member_id: r.member_id, household_id: r.household_id, agency_id: r.agency_id, status: 'enrolled', variant: variant.key })
    if (enrollErr) continue // already enrolled/sent → skip (idempotent)

    // Slice 8 §18 — resolve declared claims for this recipient; an unverified/conflicting
    // field excludes the send (gate data_confidence) + raises a verification task (§13).
    const claims = declaredClaims.length > 0 ? await resolveClaimFields(campaign.claim_fields, { householdId: r.household_id }) : []

    const outcome = await sendThroughGate({
      channel,
      to,
      subject: channel === 'email' ? variant.subject ?? campaign.subject ?? 'A note from your Farmers FSA' : undefined,
      body: bodies.get(variant.template_id)?.body ?? '',
      bodyText: bodies.get(variant.template_id)?.bodyText ?? undefined,
      actor,
      memberId: r.member_id,
      householdId: r.household_id,
      agencyId: r.agency_id,
      entity: { type: 'campaign', id: campaignId },
      templateId: variant.template_id,
      campaignId,
      campaignVariant: variant.key,
      isSecurity: false,
      recipientContext: recipientContext(r),
      // Slice 7 — message purpose drives purpose-scoped consent + frequency + collision.
      purpose: campCtx.purpose,
      // Slice 1/7 — record the represented party (§7). A delegated campaign attributes the
      // represented agency owner + the authorizing delegation and passes the on-behalf-of
      // delegation context (re-checked fresh by the gate); a plain FSA broadcast records
      // only the recipient's represented agency.
      delegation: campCtx.delegation,
      ownership: campCtx.ownership ?? { representedAgencyId: r.agency_id },
      // Slice 8 §18 — never send a specific claim on unverified/conflicting data (§13).
      dataConfidence: claims.length > 0 ? buildDataConfidence(claims) : undefined,
    })

    if (outcome.sent) {
      counts.sent++
      await db.from('comm_campaign_enrollments').update({ status: 'sent', last_sent_at: new Date().toISOString() }).eq('campaign_id', campaignId).eq('member_id', r.member_id)
    } else {
      counts.blocked++
      counts.suppressed++
      await db.from('comm_campaign_enrollments').update({ status: 'suppressed', suppressed_reason: outcome.gate.blockedStep ?? 'blocked' }).eq('campaign_id', campaignId).eq('member_id', r.member_id)
    }
  }

  await refreshCampaignMetrics(campaignId)
  await writeAudit({ actor, action: 'ai.action', entity: 'comm_campaign', entityId: campaignId, diff: { dispatched: counts } })
  return counts
}

// Drip enroll: seed enrollments (step 0, due now) for the audience. The
// campaign-dispatch cron then advances each enrollment through the sequence steps.
async function dispatchDripEnroll(campaign: { id: string; sequence_id: string | null; audience: { kind?: string; household_ids?: string[] }; channel: string }, actor: string): Promise<DispatchCounts | { error: string }> {
  if (!campaign.sequence_id) return { error: 'Drip campaign has no sequence attached.' }
  const db = getDb()
  const audience = await resolveAudience(campaign)
  const counts: DispatchCounts = { audience: audience.length, sent: 0, suppressed: 0, blocked: 0 }
  const nowISO = new Date().toISOString()
  for (const r of audience) {
    const { error } = await db
      .from('comm_campaign_enrollments')
      .insert({ campaign_id: campaign.id, member_id: r.member_id, household_id: r.household_id, agency_id: r.agency_id, status: 'enrolled', current_step: 0, next_send_at: nowISO })
    if (!error) counts.sent++ // enrolled (actual sends happen on the drip runner)
  }
  await writeAudit({ actor, action: 'ai.action', entity: 'comm_campaign', entityId: campaign.id, diff: { drip_enrolled: counts.sent } })
  return counts
}

/** Recompute + persist campaign metrics from the message ledger (for the card UI). */
export async function refreshCampaignMetrics(campaignId: string): Promise<void> {
  const db = getDb()
  try {
    const { data } = await db.from('v_campaign_metrics').select('*').eq('campaign_id', campaignId).maybeSingle()
    if (data) {
      await db
        .from('comm_campaigns')
        .update({ metrics: data, metrics_at: new Date().toISOString() })
        .eq('id', campaignId)
    }
  } catch {
    /* best-effort */
  }
}
