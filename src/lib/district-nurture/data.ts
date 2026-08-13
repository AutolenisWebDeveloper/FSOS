// src/lib/district-nurture/data.ts
// DB helpers shared by the enrollment service and the scheduler tick, so eligibility is
// loaded ONE way and recomputed identically before enrollment AND before every touch
// (ADR-038). No business decision lives here — it only assembles the pure
// evaluateNurtureEligibility() input from the agency spine
// (v_district_nurture_candidates, dnc_entries, comm_conversations,
// district_nurture_enrollments). All reads go through getDb().
import { getDb } from '@/lib/supabase/client'
import type { NurtureEligibilityInput } from './eligibility'

export interface NurtureCampaignConfig {
  id: string
  status: string
  start_date: string | null
  daily_enrollment_limit: number
  reenroll_cooldown_days: number
  resume_cooling_off_days: number
  advisor_due_hours: number
  advisor_overdue_escalate_hours: number
  advisor_reassign_after_hours: number
  advisor_hold_behavior: 'proceed' | 'hold'
  conversation_timeout_hours: number
  purpose: string | null
}

export async function loadCampaign(campaignId: string): Promise<NurtureCampaignConfig | null> {
  const db = getDb()
  const { data } = await db
    .from('district_nurture_campaigns')
    .select(
      'id, status, start_date, daily_enrollment_limit, reenroll_cooldown_days, resume_cooling_off_days, advisor_due_hours, advisor_overdue_escalate_hours, advisor_reassign_after_hours, advisor_hold_behavior, conversation_timeout_hours, purpose',
    )
    .eq('id', campaignId)
    .maybeSingle()
  return (data as NurtureCampaignConfig | null) ?? null
}

/** One district-agent candidate from v_district_nurture_candidates. */
export interface NurtureSnapshot {
  agency_owner_id: string
  agency_id: string | null
  contact_id: string | null
  agency_name: string | null
  owner_full_name: string | null
  agency_status: string
  owner_scope: string | null
  email: string | null
  phone: string | null
  interested: boolean
  existing_leads_user: boolean
  is_security: boolean
  reachable: boolean
}

export async function loadNurtureSnapshot(agencyOwnerId: string): Promise<NurtureSnapshot | null> {
  const db = getDb()
  const { data } = await db
    .from('v_district_nurture_candidates')
    .select(
      'agency_owner_id, agency_id, contact_id, agency_name, owner_full_name, agency_status, owner_scope, email, phone, interested, existing_leads_user, is_security, reachable',
    )
    .eq('agency_owner_id', agencyOwnerId)
    .maybeSingle()
  return (data as NurtureSnapshot | null) ?? null
}

/** Last 10 digits of a phone, for suffix-tolerant DNC matching. */
function phoneTail(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '').slice(-10)
}

/**
 * True when this agent has opted out on any channel. The send gate re-checks DNC/consent
 * authoritatively on every send; this is the enrollment-time courtesy so an opted-out
 * agent is never enrolled or advanced. Fails safe (opted-out) on read error.
 */
async function isOptedOut(email: string | null, phone: string | null): Promise<boolean> {
  const db = getDb()
  const emailLc = email?.trim().toLowerCase() || null
  const tail = phoneTail(phone)

  if (emailLc) {
    const { data, error } = await db.from('dnc_entries').select('id').ilike('contact', emailLc).limit(1)
    if (error) return true // fail safe
    if ((data ?? []).length > 0) return true
  }
  if (tail) {
    // dnc phone rows may be stored with punctuation/+1; match on the trailing 10 digits.
    const { data, error } = await db.from('dnc_entries').select('id').ilike('contact', `%${tail}`).limit(1)
    if (error) return true // fail safe
    if ((data ?? []).length > 0) return true
  }
  return false
}

/** True when a live (open) conversation exists for this agency — ADR-018 reply pause. */
async function hasOpenConversation(agencyId: string | null): Promise<boolean> {
  if (!agencyId) return false
  const db = getDb()
  const { count } = await db
    .from('comm_conversations')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId)
    .eq('status', 'open')
  return (count ?? 0) > 0
}

/**
 * Assemble the pure eligibility input for an agency owner against a campaign. When the
 * view has no row (not a current candidate), fail CLOSED — reachable=false and
 * agency_status='terminated' so evaluateNurtureEligibility() returns not-eligible.
 */
export async function loadNurtureEligibilityInput(
  campaign: NurtureCampaignConfig,
  agencyOwnerId: string,
  // At the pre-touch recheck the enrollment being advanced is itself live for this
  // (campaign, agent); exclude it so it does not flag itself as a duplicate.
  excludeEnrollmentId?: string,
): Promise<{ input: NurtureEligibilityInput; snapshot: NurtureSnapshot | null }> {
  const db = getDb()
  const snap = await loadNurtureSnapshot(agencyOwnerId)

  let priorQ = db
    .from('district_nurture_enrollments')
    .select('id, status')
    .eq('campaign_id', campaign.id)
    .eq('agency_owner_id', agencyOwnerId)
    .in('status', ['active', 'paused_for_conversation', 'paused_by_admin'])
  if (excludeEnrollmentId) priorQ = priorQ.neq('id', excludeEnrollmentId)
  const { data: prior } = await priorQ.limit(1).maybeSingle()

  // Re-enroll cooldown: a recent exit inside reenroll_cooldown_days blocks a fresh enroll.
  let cooldownActive = false
  if (!excludeEnrollmentId && campaign.reenroll_cooldown_days > 0) {
    const cutoff = new Date(Date.now() - campaign.reenroll_cooldown_days * 86400000).toISOString()
    const { data: recentExit } = await db
      .from('district_nurture_enrollments')
      .select('id, completed_at')
      .eq('campaign_id', campaign.id)
      .eq('agency_owner_id', agencyOwnerId)
      .in('status', ['exited', 'completed'])
      .gte('completed_at', cutoff)
      .limit(1)
      .maybeSingle()
    cooldownActive = !!recentExit
  }

  const optedOut = snap ? await isOptedOut(snap.email, snap.phone) : true
  const inActiveConversation = await hasOpenConversation(snap?.agency_id ?? null)

  const input: NurtureEligibilityInput = {
    reachable: snap ? snap.reachable === true : false,
    agencyStatus: snap?.agency_status ?? 'terminated', // fail closed when no row
    optedOut,
    inActiveConversation,
    priorEnrollmentActive: !!prior,
    cooldownActive,
  }
  return { input, snapshot: snap }
}
