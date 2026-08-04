// src/lib/life-campaign/data.ts
// DB helpers shared by the enrollment service and the scheduler tick, so eligibility is
// loaded ONE way and recomputed identically before enrollment AND before every touch
// (owner-approved Checkpoint 1). No business decision lives here — it only assembles the
// pure evaluateEligibility() input from the aggregate-root spine (v_conversions_due,
// opportunities, households, life_campaign_enrollments). All reads go through getDb().
import { getDb } from '@/lib/supabase/client'
import type { EligibilityInput } from './eligibility'
import { TERMINAL_LOST_STAGES, CLOSED_WON_STAGES } from './eligibility'

export interface CampaignConfig {
  id: string
  status: string
  reenroll_cooldown_days: number
  early_enrollment_buffer_days: number
  advisor_due_hours: number
  advisor_overdue_escalate_hours: number
  advisor_reassign_after_hours: number
  advisor_hold_behavior: 'proceed' | 'hold'
  conversation_timeout_hours: number
  daily_enrollment_limit: number
  purpose: string | null
  represented_agency_owner_id: string | null
  delegation_id: string | null
}

export async function loadCampaign(campaignId: string): Promise<CampaignConfig | null> {
  const db = getDb()
  const { data } = await db
    .from('life_campaigns')
    .select(
      'id, status, reenroll_cooldown_days, early_enrollment_buffer_days, advisor_due_hours, advisor_overdue_escalate_hours, advisor_reassign_after_hours, advisor_hold_behavior, conversation_timeout_hours, daily_enrollment_limit, purpose, represented_agency_owner_id, delegation_id',
    )
    .eq('id', campaignId)
    .maybeSingle()
  return (data as CampaignConfig | null) ?? null
}

export interface ConversionSnapshot {
  household_id: string | null
  is_security: boolean
  conversion_deadline: string | null
}

/** The verified deadline + firewall flag for a policy, from v_conversions_due (the single
 *  eligibility source — never a second deadline calc). null when the policy isn't in-window. */
export async function loadConversionSnapshot(policyId: string): Promise<ConversionSnapshot | null> {
  const db = getDb()
  const { data } = await db
    .from('v_conversions_due')
    .select('household_id, is_security, conversion_deadline')
    .eq('policy_id', policyId)
    .maybeSingle()
  return (data as ConversionSnapshot | null) ?? null
}

/**
 * Assemble the pure eligibility input for a (policy, member) against a campaign. Returns null
 * only when the campaign is missing; a missing conversion row surfaces as no_verified_deadline
 * (is_security defaults true → firewall-closed when the row is absent, never assumed safe).
 */
export async function loadEligibilityInput(
  campaign: CampaignConfig,
  policyId: string,
  memberId: string,
  nowISO: string,
  // At the pre-touch recheck the enrollment being advanced is itself an ACTIVE row for this
  // (campaign, member); counting it would raise `duplicate_active` and terminally self-exit the
  // enrollment on its very first touch. Callers rechecking an existing enrollment pass its id so
  // the idempotent-enrollment guard excludes self. Enroll-time callers omit it (nothing to exclude).
  excludeEnrollmentId?: string,
): Promise<EligibilityInput> {
  const db = getDb()
  const snap = await loadConversionSnapshot(policyId)

  // Open + terminal term_conversion opportunities for this policy.
  const { data: opps } = await db
    .from('opportunities')
    .select('stage, updated_at')
    .eq('policy_id', policyId)
    .eq('source', 'term_conversion')
  const openOpportunities = (opps ?? []).map((o) => ({ stage: String(o.stage ?? '') }))
  const terminalStages = new Set<string>([...TERMINAL_LOST_STAGES, ...CLOSED_WON_STAGES])
  const lastTerminalAt =
    (opps ?? [])
      .filter((o) => terminalStages.has(String(o.stage ?? '')))
      .map((o) => o.updated_at as string | null)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null

  // An active enrollment for this member+campaign (idempotent-enrollment guard). At recheck we
  // exclude the enrollment currently being advanced so it does not flag itself as a duplicate.
  let priorQ = db
    .from('life_campaign_enrollments')
    .select('id, status')
    .eq('campaign_id', campaign.id)
    .eq('member_id', memberId)
    .in('status', ['active', 'paused_for_conversation', 'paused_by_admin'])
  if (excludeEnrollmentId) priorQ = priorQ.neq('id', excludeEnrollmentId)
  const { data: prior } = await priorQ.limit(1).maybeSingle()

  // Marketing opt-out (household do_not_contact — the same suppression signal the segment
  // resolver uses; per-channel consent/DNC is additionally enforced by the send gate).
  let optedOut = false
  if (snap?.household_id) {
    const { data: hh } = await db.from('households').select('do_not_contact').eq('id', snap.household_id).maybeSingle()
    optedOut = hh?.do_not_contact === true
  }

  return {
    isSecurity: snap ? snap.is_security === true : true, // firewall-closed if no row
    openOpportunities,
    priorEnrollmentActive: !!prior,
    optedOut,
    lastTerminalAt,
    cooldownDays: campaign.reenroll_cooldown_days,
    now: nowISO,
    conversionDeadline: snap?.conversion_deadline ?? null,
  }
}
