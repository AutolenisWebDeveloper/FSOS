// src/lib/district-nurture/enroll.ts
// Enrollment service for the District Agent FS Nurture Campaign (ADR-038). Recomputes
// eligibility (opt-out + agency status + reachability + duplicate + cooldown) then inserts
// an enrollment idempotently (DB unique (campaign_id, agency_owner_id) is the guard).
// Baseline = greatest(configured start_date, today). Nothing is SENT here — sends happen
// in the tick, all through the gate.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { evaluateNurtureEligibility, OVERRIDABLE_REASONS, type NurtureEligibilityReason } from './eligibility'
import { computeTouchPlan } from './schedule'
import { loadCampaign, loadNurtureEligibilityInput } from './data'

// Campaign states in which NEW enrollments are NOT accepted (§5a).
const ENROLLMENT_BLOCKED_STATES = new Set(['disabled', 'emergency_stopped', 'archived'])
const OVERRIDABLE = new Set<NurtureEligibilityReason>(OVERRIDABLE_REASONS)

export type NurtureEnrollReason = NurtureEligibilityReason | 'campaign_missing' | 'enrollment_closed' | 'no_candidate'

export interface NurtureEnrollResult {
  enrolled: boolean
  enrollmentId?: string
  reasons?: NurtureEnrollReason[]
}

export interface NurtureEnrollInput {
  campaignId: string
  agencyOwnerId: string
  actor: string
  /** Manual enrollment bypassing the re-enroll cooldown only, audited. */
  manualOverride?: boolean
}

/** Baseline = the later of the campaign's configured start_date and today. */
function resolveBaseline(startDate: string | null, today: string): string {
  if (startDate && startDate.slice(0, 10) > today) return startDate.slice(0, 10)
  return today
}

export async function enrollAgent(input: NurtureEnrollInput): Promise<NurtureEnrollResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const today = nowISO.slice(0, 10)

  const campaign = await loadCampaign(input.campaignId)
  if (!campaign) return { enrolled: false, reasons: ['campaign_missing'] }
  if (ENROLLMENT_BLOCKED_STATES.has(campaign.status)) return { enrolled: false, reasons: ['enrollment_closed'] }

  const { input: eligInput, snapshot } = await loadNurtureEligibilityInput(campaign, input.agencyOwnerId)
  if (!snapshot) return { enrolled: false, reasons: ['no_candidate'] }

  const { reasons } = evaluateNurtureEligibility(eligInput)
  const blocking = input.manualOverride ? reasons.filter((r) => !OVERRIDABLE.has(r)) : reasons
  if (blocking.length > 0) {
    if (input.manualOverride) {
      await writeAudit({
        actor: input.actor,
        action: 'ai.escalated',
        entity: 'district_nurture_enrollment',
        diff: { attempted_manual_enroll: true, agency_owner_id: input.agencyOwnerId, blocked: blocking },
      })
    }
    return { enrolled: false, reasons: blocking }
  }

  const baseline = resolveBaseline(campaign.start_date, today)
  const plan = computeTouchPlan(baseline)
  const firstDue = `${plan[0].dueDate}T13:00:00.000Z`

  const { data: inserted, error } = await db
    .from('district_nurture_enrollments')
    .insert({
      campaign_id: campaign.id,
      agency_id: snapshot.agency_id,
      agency_owner_id: input.agencyOwnerId,
      contact_id: snapshot.contact_id,
      owner_scope: snapshot.owner_scope,
      email: snapshot.email,
      phone: snapshot.phone,
      status: 'active',
      baseline_date: baseline,
      current_touch_no: 0,
      next_touch_at: firstDue,
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
    entity: 'district_nurture_enrollment',
    entityId: inserted?.id ?? null,
    diff: { campaign_id: campaign.id, agency_owner_id: input.agencyOwnerId, manual: !!input.manualOverride },
  })
  return { enrolled: true, enrollmentId: inserted?.id }
}

/** Manual removal — an exit event, logged like any other exit (§10). */
export async function removeEnrollment(input: { enrollmentId: string; actor: string; reason: string }): Promise<{ ok: boolean }> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  await db
    .from('district_nurture_enrollments')
    .update({ status: 'exited', exit_reason: input.reason, completed_at: nowISO, updated_at: nowISO })
    .eq('id', input.enrollmentId)
    .in('status', ['active', 'paused_for_conversation', 'paused_by_admin'])
  await writeAudit({
    actor: input.actor,
    action: 'entity.updated',
    entity: 'district_nurture_enrollment',
    entityId: input.enrollmentId,
    diff: { exited: true, reason: input.reason },
  })
  return { ok: true }
}
