// src/lib/pipeline-winback/data.ts
// DB helpers shared by the enrollment service and the scheduler tick, so eligibility is loaded
// ONE way and recomputed identically before enrollment AND before every touch (ADR-031). No
// business decision lives here — it only assembles the pure evaluateWinbackEligibility() input
// from the aggregate-root spine (v_pipeline_winback_due, opportunities, households, appointments,
// comm_conversations, pipeline_winback_enrollments). All reads go through getDb().
import { getDb } from '@/lib/supabase/client'
import type { WinbackEligibilityInput } from './eligibility'

export interface WinbackCampaignConfig {
  id: string
  status: string
  daily_enrollment_limit: number
  stale_min_days: number
  reenroll_cooldown_days: number
  advisor_due_hours: number
  advisor_overdue_escalate_hours: number
  advisor_reassign_after_hours: number
  advisor_hold_behavior: 'proceed' | 'hold'
  conversation_timeout_hours: number
  purpose: string | null
  represented_agency_owner_id: string | null
  delegation_id: string | null
}

export async function loadCampaign(campaignId: string): Promise<WinbackCampaignConfig | null> {
  const db = getDb()
  const { data } = await db
    .from('pipeline_winback_campaigns')
    .select(
      'id, status, daily_enrollment_limit, stale_min_days, reenroll_cooldown_days, advisor_due_hours, advisor_overdue_escalate_hours, advisor_reassign_after_hours, advisor_hold_behavior, conversation_timeout_hours, purpose, represented_agency_owner_id, delegation_id',
    )
    .eq('id', campaignId)
    .maybeSingle()
  return (data as WinbackCampaignConfig | null) ?? null
}

// The candidate snapshot from v_pipeline_winback_due for one stalled opportunity. The view is
// the single eligibility source of truth (spec §0.9); everything reads from it, nothing
// recomputes its WHERE clause.
export interface WinbackSnapshot {
  opportunity_id: string
  household_id: string | null
  contact_id: string | null
  referring_agency_id: string | null
  stage: string
  is_security: boolean
  stale_days: number
  winback_category: string | null
  do_not_contact: boolean
  has_active_advisor_opportunity: boolean
  has_upcoming_appointment: boolean
  primary_name: string | null
}

/** The win-back candidate row for an opportunity, or null when it isn't currently eligible
 *  per the view (out-of-window, securities, opted-out, owned by another flow, or not stale). */
export async function loadWinbackSnapshot(opportunityId: string): Promise<WinbackSnapshot | null> {
  const db = getDb()
  const { data } = await db
    .from('v_pipeline_winback_due')
    .select(
      'opportunity_id, household_id, contact_id, referring_agency_id, stage, is_security, stale_days, winback_category, do_not_contact, has_active_advisor_opportunity, has_upcoming_appointment, primary_name',
    )
    .eq('opportunity_id', opportunityId)
    .maybeSingle()
  return (data as WinbackSnapshot | null) ?? null
}

/** True when the household has an OPEN comms conversation — shared suppression: an active
 *  advisor/AI conversation pauses win-back outreach (spec §4/§9). */
async function hasOpenConversation(householdId: string | null): Promise<boolean> {
  if (!householdId) return false
  const db = getDb()
  const { count } = await db
    .from('comm_conversations')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', householdId)
    .eq('status', 'open')
  return (count ?? 0) > 0
}

/**
 * Assemble the pure eligibility input for an opportunity against a campaign. When the view has
 * no row for the opportunity (not a current candidate), we fail CLOSED — is_security defaults
 * true and stage becomes '' so evaluateWinbackEligibility() returns not-eligible with
 * securities/not_candidate reasons rather than ever assuming safe.
 */
export async function loadWinbackEligibilityInput(
  campaign: WinbackCampaignConfig,
  opportunityId: string,
  // At the pre-touch recheck the enrollment being advanced is itself a live row for this
  // (campaign, opportunity); counting it raises `duplicate_active` and terminally self-exits the
  // enrollment on its first touch. Recheck callers pass its id to exclude self; enroll-time
  // callers omit it.
  excludeEnrollmentId?: string,
): Promise<{ input: WinbackEligibilityInput; snapshot: WinbackSnapshot | null }> {
  const db = getDb()
  const snap = await loadWinbackSnapshot(opportunityId)

  // A live enrollment for this opportunity+campaign (idempotent-enrollment guard). At recheck we
  // exclude the enrollment currently being advanced so it does not flag itself as a duplicate.
  let priorQ = db
    .from('pipeline_winback_enrollments')
    .select('id, status')
    .eq('campaign_id', campaign.id)
    .eq('opportunity_id', opportunityId)
    .in('status', ['active', 'paused_for_conversation', 'paused_by_admin'])
  if (excludeEnrollmentId) priorQ = priorQ.neq('id', excludeEnrollmentId)
  const { data: prior } = await priorQ.limit(1).maybeSingle()

  const inActiveConversation = await hasOpenConversation(snap?.household_id ?? null)

  const input: WinbackEligibilityInput = {
    isSecurity: snap ? snap.is_security === true : true, // firewall-closed if no row
    optedOut: snap ? snap.do_not_contact === true : true,
    stage: snap?.stage ?? '',
    staleDays: snap?.stale_days ?? 0,
    staleMinDays: campaign.stale_min_days,
    hasActiveAdvisorOpportunity: snap ? snap.has_active_advisor_opportunity === true : true,
    hasUpcomingAppointment: snap ? snap.has_upcoming_appointment === true : true,
    inActiveConversation,
    priorEnrollmentActive: !!prior,
  }
  return { input, snapshot: snap }
}
