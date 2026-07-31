// src/lib/life-campaign/enroll.ts
// Enrollment service for the Life Conversion Campaign (§4/§4a). Recomputes eligibility
// (Active Opportunity Ownership + securities firewall + suppression + cooldown + verified
// deadline) then inserts an enrollment idempotently (the DB unique (campaign_id, member_id)
// is the duplicate guard). Baseline = today; the timeline is computed from the pure schedule
// engine. Nothing is SENT here — sends happen in the tick, all through the compliance gate.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { evaluateEligibility, type EligibilityReason } from './eligibility'
import { earlyEnrollmentFits, computeTouchPlan } from './schedule'
import { loadCampaign, loadEligibilityInput } from './data'

// Campaign states in which NEW enrollments are NOT accepted (§4b): disabled, emergency-stopped,
// archived. Draft/approval_pending/active/paused all accept enrollments (sends stay gated on
// the campaign being Active).
const ENROLLMENT_BLOCKED_STATES = new Set(['disabled', 'emergency_stopped', 'archived'])
// A manual override (§4a) may waive only the soft cooldown gate — never the firewall, opt-out,
// active/won opportunity ownership, a missing verified deadline, or the duplicate guard.
const OVERRIDABLE_REASONS = new Set<EligibilityReason>(['cooldown'])

export type EnrollReason = EligibilityReason | 'campaign_missing' | 'enrollment_closed' | 'insufficient_time' | 'no_member'

export interface EnrollResult {
  enrolled: boolean
  enrollmentId?: string
  reasons?: EnrollReason[]
}

export interface EnrollInput {
  campaignId: string
  memberId: string
  policyId: string
  actor: string
  /** Manual advisor enrollment bypassing auto triggers — waives cooldown only, audit-logged. */
  manualOverride?: boolean
}

export async function enrollContact(input: EnrollInput): Promise<EnrollResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const today = nowISO.slice(0, 10)

  const campaign = await loadCampaign(input.campaignId)
  if (!campaign) return { enrolled: false, reasons: ['campaign_missing'] }
  if (ENROLLMENT_BLOCKED_STATES.has(campaign.status)) return { enrolled: false, reasons: ['enrollment_closed'] }

  // Resolve the member's household so the enrollment carries the spine linkage.
  const { data: member } = await db
    .from('household_members')
    .select('id, household_id')
    .eq('id', input.memberId)
    .maybeSingle()
  if (!member) return { enrolled: false, reasons: ['no_member'] }

  const eligInput = await loadEligibilityInput(campaign, input.policyId, input.memberId, nowISO)
  const { eligible, reasons } = evaluateEligibility(eligInput)

  // Apply the manual override: keep only the reasons an override cannot waive.
  const blocking = input.manualOverride ? reasons.filter((r) => !OVERRIDABLE_REASONS.has(r)) : reasons
  if (blocking.length > 0) {
    if (input.manualOverride) {
      await writeAudit({
        actor: input.actor,
        action: 'ai.escalated',
        entity: 'life_campaign_enrollment',
        diff: { attempted_manual_enroll: true, member_id: input.memberId, policy_id: input.policyId, blocked: blocking },
      })
    }
    return { enrolled: false, reasons: blocking }
  }

  // Deadline safety (§5): the full 180-day run must finish with buffer before the real deadline.
  if (
    eligInput.conversionDeadline &&
    !earlyEnrollmentFits(eligInput.conversionDeadline, today, campaign.early_enrollment_buffer_days)
  ) {
    // Do NOT enroll in the full campaign — route to an advisor/compressed path (not built here).
    await db.from('work_tasks').insert({
      title: 'Life Conversion — deadline too close for full campaign; advisor review',
      entity_type: 'policy',
      entity_id: input.policyId,
      source: 'workflow',
    })
    return { enrolled: false, reasons: ['insufficient_time'] }
  }

  // First touch is due on the baseline day; the gate enforces recipient-local quiet hours,
  // so a mid-day UTC anchor is safe and never sends outside 9am–8pm local.
  const plan = computeTouchPlan(today)
  const firstDue = `${plan[0].dueDate}T13:00:00.000Z`

  const { data: inserted, error } = await db
    .from('life_campaign_enrollments')
    .insert({
      campaign_id: campaign.id,
      household_id: member.household_id,
      member_id: input.memberId,
      policy_id: input.policyId,
      status: 'active',
      baseline_date: today,
      current_touch_no: 0,
      next_touch_at: firstDue,
      conversion_deadline: eligInput.conversionDeadline,
      enrolled_by: input.actor,
    })
    .select('id')
    .maybeSingle()

  // 23505 = unique_violation → a concurrent/duplicate enrollment already exists (idempotent).
  if (error) {
    if ((error as { code?: string }).code === '23505') return { enrolled: false, reasons: ['duplicate_active'] }
    throw error
  }

  await writeAudit({
    actor: input.actor,
    action: 'entity.created',
    entity: 'life_campaign_enrollment',
    entityId: inserted?.id ?? null,
    diff: { campaign_id: campaign.id, member_id: input.memberId, policy_id: input.policyId, manual: !!input.manualOverride },
  })
  return { enrolled: true, enrollmentId: inserted?.id }
}

/** Manual removal (§4a) — an exit event, logged like any other exit (§13). */
export async function removeEnrollment(input: { enrollmentId: string; actor: string; reason: string }): Promise<{ ok: boolean }> {
  const db = getDb()
  await db
    .from('life_campaign_enrollments')
    .update({ status: 'exited', exit_reason: input.reason, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', input.enrollmentId)
    .in('status', ['active', 'paused_for_conversation', 'paused_by_admin'])
  await writeAudit({
    actor: input.actor,
    action: 'entity.updated',
    entity: 'life_campaign_enrollment',
    entityId: input.enrollmentId,
    diff: { exited: true, reason: input.reason },
  })
  return { ok: true }
}
