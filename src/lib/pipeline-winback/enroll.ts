// src/lib/pipeline-winback/enroll.ts
// Enrollment service for the Pipeline Win-Back Campaign (§4/§5). Recomputes eligibility
// (securities firewall + shared suppression + advisor-ownership precedence + staleness +
// duplicate guard) then inserts an enrollment idempotently (the DB unique (campaign_id,
// opportunity_id) is the duplicate guard). Baseline = today; the timeline is computed from the
// pure schedule engine. Nothing is SENT here — sends happen in the tick, all through the gate.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { enrollmentTimezoneFor } from '@/lib/comms/recipient-timezone-db'
import { evaluateWinbackEligibility, type WinbackEligibilityReason } from './eligibility'
import { computeTouchPlan } from './schedule'
import { loadCampaign, loadWinbackEligibilityInput } from './data'

// Campaign states in which NEW enrollments are NOT accepted (§5a): disabled, emergency-stopped,
// archived. Draft/approval_pending/active/paused all accept enrollments (sends stay gated on the
// campaign being Active).
const ENROLLMENT_BLOCKED_STATES = new Set(['disabled', 'emergency_stopped', 'archived'])
// A manual override (§5a) may waive only the soft staleness gate — never the firewall, opt-out,
// advisor-ownership precedence, an active appointment/conversation, or the duplicate guard.
const OVERRIDABLE_REASONS = new Set<WinbackEligibilityReason>(['not_stalled'])

export type WinbackEnrollReason = WinbackEligibilityReason | 'campaign_missing' | 'enrollment_closed' | 'no_opportunity'

export interface WinbackEnrollResult {
  enrolled: boolean
  enrollmentId?: string
  reasons?: WinbackEnrollReason[]
}

export interface WinbackEnrollInput {
  campaignId: string
  opportunityId: string
  actor: string
  /** Manual advisor enrollment bypassing auto triggers — waives the staleness floor only, audited. */
  manualOverride?: boolean
}

export async function enrollOpportunity(input: WinbackEnrollInput): Promise<WinbackEnrollResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const today = nowISO.slice(0, 10)

  const campaign = await loadCampaign(input.campaignId)
  if (!campaign) return { enrolled: false, reasons: ['campaign_missing'] }
  if (ENROLLMENT_BLOCKED_STATES.has(campaign.status)) return { enrolled: false, reasons: ['enrollment_closed'] }

  const { input: eligInput, snapshot } = await loadWinbackEligibilityInput(campaign, input.opportunityId)
  if (!snapshot) return { enrolled: false, reasons: ['no_opportunity'] }

  const { reasons } = evaluateWinbackEligibility(eligInput)
  const blocking = input.manualOverride ? reasons.filter((r) => !OVERRIDABLE_REASONS.has(r)) : reasons
  if (blocking.length > 0) {
    if (input.manualOverride) {
      await writeAudit({
        actor: input.actor,
        action: 'ai.escalated',
        entity: 'pipeline_winback_enrollment',
        diff: { attempted_manual_enroll: true, opportunity_id: input.opportunityId, blocked: blocking },
      })
    }
    return { enrolled: false, reasons: blocking }
  }

  // Resolve the primary household member as the default recipient (falls back to contact at send).
  let memberId: string | null = null
  if (snapshot.household_id) {
    const { data: member } = await db
      .from('household_members')
      .select('id')
      .eq('household_id', snapshot.household_id)
      .limit(1)
      .maybeSingle()
    memberId = member?.id ?? null
  }

  // First touch is due on the baseline day; the gate enforces recipient-local quiet hours, so a
  // mid-day UTC anchor is safe and never sends outside 9am–8pm local.
  const plan = computeTouchPlan(today)
  const firstDue = `${plan[0].dueDate}T13:00:00.000Z`

  const enrollTz = await enrollmentTimezoneFor(memberId, snapshot.household_id)

  const { data: inserted, error } = await db
    .from('pipeline_winback_enrollments')
    .insert({
      campaign_id: campaign.id,
      opportunity_id: input.opportunityId,
      household_id: snapshot.household_id,
      member_id: memberId,
      contact_id: snapshot.contact_id,
      agency_id: snapshot.referring_agency_id,
      status: 'active',
      baseline_date: today,
      current_touch_no: 0,
      next_touch_at: firstDue,
      stale_days_at_enroll: snapshot.stale_days,
      winback_category: snapshot.winback_category,
      enrolled_by: input.actor,
      // Recipient-zone stamp for AUDIT/REPORTING only — dispatch resolves fresh every
      // send (mig 123). Unresolvable → omit, keeping the column default.
      ...(enrollTz ? { timezone: enrollTz } : {}),
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
    entity: 'pipeline_winback_enrollment',
    entityId: inserted?.id ?? null,
    diff: { campaign_id: campaign.id, opportunity_id: input.opportunityId, manual: !!input.manualOverride },
  })
  return { enrolled: true, enrollmentId: inserted?.id }
}

/** Manual removal (§5a) — an exit event, logged like any other exit (§10). */
export async function removeEnrollment(input: { enrollmentId: string; actor: string; reason: string }): Promise<{ ok: boolean }> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  await db
    .from('pipeline_winback_enrollments')
    .update({ status: 'exited', exit_reason: input.reason, completed_at: nowISO, updated_at: nowISO })
    .eq('id', input.enrollmentId)
    .in('status', ['active', 'paused_for_conversation', 'paused_by_admin'])
  await writeAudit({
    actor: input.actor,
    action: 'entity.updated',
    entity: 'pipeline_winback_enrollment',
    entityId: input.enrollmentId,
    diff: { exited: true, reason: input.reason },
  })
  return { ok: true }
}
