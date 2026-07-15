// src/lib/comms/campaign.ts
// WF-5 campaign dispatch. Iterates a campaign's audience and, FOR EACH recipient,
// runs the 7-step gate at send time via sendThroughGate(): consent, quiet-hours,
// DNC, approved template, recommendation, is_security, other rule. Pass → send;
// fail → suppressed + reason recorded + escalated (never silently dropped). There
// is no bypass. Used by the activate API and the campaign-dispatch cron job.
import { getDb } from '@/lib/supabase/client'
import { sendThroughGate } from './send'
import { isTemplateApproved } from './send'
import { writeAudit } from '@/lib/audit/log'

export interface DispatchCounts {
  audience: number
  sent: number
  suppressed: number
  blocked: number
}

interface Recipient {
  member_id: string
  household_id: string
  email: string | null
  phone: string | null
}

async function resolveAudience(campaign: { channel: string; audience: { kind?: string; household_ids?: string[] } }): Promise<Recipient[]> {
  const db = getDb()
  const kind = campaign.audience?.kind ?? 'all_consented'
  const channel = campaign.channel as 'sms' | 'email'

  // Base: household members with a contact on the campaign channel, household not DNC.
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

  let q = db.from('household_members').select('id, household_id, email, phone, households!inner(do_not_contact, deleted_at)').is('households.deleted_at', null).eq('households.do_not_contact', false).limit(5000)
  if (householdIds) {
    if (householdIds.length === 0) return []
    q = q.in('household_id', householdIds)
  }
  const { data } = await q
  const rows = (data ?? []) as unknown as { id: string; household_id: string; email: string | null; phone: string | null }[]
  return rows
    .map((r) => ({ member_id: r.id, household_id: r.household_id, email: r.email, phone: r.phone }))
    .filter((r) => (channel === 'email' ? !!r.email : !!r.phone))
}

/** Dispatch a campaign through the gate. Idempotent per (campaign, member) enrollment. */
export async function dispatchCampaign(campaignId: string, actor: string): Promise<DispatchCounts | { error: string }> {
  const db = getDb()
  const { data: campaign } = await db.from('comm_campaigns').select('*').eq('id', campaignId).maybeSingle()
  if (!campaign) return { error: 'Campaign not found' }

  // Re-check the template is approved at dispatch time (unapproved is unusable).
  if (!(await isTemplateApproved(campaign.template_id))) {
    return { error: 'Campaign template is not approved.' }
  }
  const { data: tpl } = await db.from('comm_templates').select('body').eq('id', campaign.template_id).maybeSingle()
  const body = tpl?.body ?? ''
  const channel = campaign.channel as 'sms' | 'email'

  const audience = await resolveAudience(campaign)
  const counts: DispatchCounts = { audience: audience.length, sent: 0, suppressed: 0, blocked: 0 }

  for (const r of audience) {
    const to = channel === 'email' ? r.email! : r.phone!
    // Idempotent enrollment: a unique (campaign_id, member_id) prevents double-send.
    const { error: enrollErr } = await db.from('comm_campaign_enrollments').insert({ campaign_id: campaignId, member_id: r.member_id, household_id: r.household_id, status: 'enrolled' })
    if (enrollErr) continue // already enrolled/sent → skip (idempotent)

    const outcome = await sendThroughGate({
      channel,
      to,
      subject: campaign.category ? `A note from your Farmers FSA` : undefined,
      body,
      actor,
      memberId: r.member_id,
      householdId: r.household_id,
      entity: { type: 'campaign', id: campaignId },
      templateId: campaign.template_id,
      campaignId,
      isSecurity: false,
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

  await writeAudit({ actor, action: 'ai.action', entity: 'comm_campaign', entityId: campaignId, diff: { dispatched: counts } })
  return counts
}
