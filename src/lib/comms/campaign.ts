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

async function resolveAudience(campaign: { channel: string; audience: { kind?: string; household_ids?: string[] } }): Promise<Recipient[]> {
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

async function templateBody(templateId: string): Promise<string> {
  const { data } = await getDb().from('comm_templates').select('body').eq('id', templateId).maybeSingle()
  return data?.body ?? ''
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
  // Pre-load bodies once.
  const bodies = new Map<string, string>()
  for (const v of variants) bodies.set(v.template_id, await templateBody(v.template_id))

  const channel = campaign.channel as 'sms' | 'email'
  const audience = await resolveAudience(campaign)
  const counts: DispatchCounts = { audience: audience.length, sent: 0, suppressed: 0, blocked: 0 }

  for (const r of audience) {
    const to = channel === 'email' ? r.email! : r.phone!
    const variant = pickVariant(variants, r.member_id)

    // Idempotent enrollment: a unique (campaign_id, member_id) prevents double-send.
    const { error: enrollErr } = await db
      .from('comm_campaign_enrollments')
      .insert({ campaign_id: campaignId, member_id: r.member_id, household_id: r.household_id, agency_id: r.agency_id, status: 'enrolled', variant: variant.key })
    if (enrollErr) continue // already enrolled/sent → skip (idempotent)

    const outcome = await sendThroughGate({
      channel,
      to,
      subject: channel === 'email' ? variant.subject ?? campaign.subject ?? 'A note from your Farmers FSA' : undefined,
      body: bodies.get(variant.template_id) ?? '',
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
      // Slice 1 — record the represented agency on every campaign message (§7). The
      // represented agency owner / delegation are attached by the delegated-campaign
      // path (later slice); a plain FSA broadcast records the represented agency only.
      ownership: { representedAgencyId: r.agency_id },
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
