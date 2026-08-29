// src/lib/cross-sell-life/enroll.ts
// Enrollment service for the Cross-Sell Life Campaign (§3/§5). Recomputes eligibility (existing
// non-life client + no active life relationship + population separation + consent + jurisdiction +
// cooldown + duplicate guard) then inserts an enrollment idempotently (the DB unique
// (campaign_id, member_id) is the duplicate guard). Baseline = today (deferred to the next allowed
// business day); the timeline is computed from the pure schedule engine. Nothing is SENT here —
// sends happen in the tick, all through the compliance gate.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { enrollmentTimezoneFor } from '@/lib/comms/recipient-timezone-db'
import { evaluateEligibility, blockingAfterOverride, type EligibilityReason } from './eligibility'
import { computeTouchPlan, deferToBusinessDay } from './schedule'
import { loadCampaign, loadEligibilityInput, primaryMemberForHousehold, type CampaignConfig } from './data'

// Campaign states in which NEW enrollments are NOT accepted (§ Operational Controls). Draft/
// approval_pending/active/paused all accept enrollments (sends stay gated on the campaign being
// Active); disabled/emergency_stopped/archived block enrollment.
const ENROLLMENT_BLOCKED_STATES = new Set(['disabled', 'emergency_stopped', 'archived'])

export type EnrollReason = EligibilityReason | 'campaign_missing' | 'enrollment_closed' | 'no_member'

export interface EnrollResult {
  enrolled: boolean
  enrollmentId?: string
  reasons?: EnrollReason[]
}

export interface EnrollInput {
  campaignId: string
  householdId: string
  /** Optional explicit member; defaults to the household's primary member. */
  memberId?: string
  actor: string
  /** Force/manual enrollment — waives cooldown only (never firewall/opt-out/life/dup), audit-logged. */
  forceOverride?: boolean
}

export async function enrollContact(input: EnrollInput): Promise<EnrollResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  const campaign = await loadCampaign(input.campaignId)
  if (!campaign) return { enrolled: false, reasons: ['campaign_missing'] }
  if (ENROLLMENT_BLOCKED_STATES.has(campaign.status)) return { enrolled: false, reasons: ['enrollment_closed'] }

  const member = input.memberId
    ? await db.from('household_members').select('id, household_id').eq('id', input.memberId).maybeSingle().then((r) => r.data as { id: string; household_id: string } | null)
    : await primaryMemberForHousehold(input.householdId)
  if (!member) return { enrolled: false, reasons: ['no_member'] }

  const eligInput = await loadEligibilityInput(campaign, member.household_id, member.id, nowISO)
  const { reasons } = evaluateEligibility(eligInput)
  const blocking = blockingAfterOverride(reasons, !!input.forceOverride)
  if (blocking.length > 0) {
    if (input.forceOverride) {
      await writeAudit({
        actor: input.actor,
        action: 'ai.escalated',
        entity: 'xsell_life_campaign_enrollment',
        diff: { attempted_force_enroll: true, household_id: member.household_id, member_id: member.id, blocked: blocking },
      })
    }
    return { enrolled: false, reasons: blocking }
  }

  // Household context for the enrollment linkage (agency, jurisdiction, qualifying relationship).
  const { data: hh } = await db
    .from('households')
    .select('referring_agency_id, state')
    .eq('id', member.household_id)
    .maybeSingle()
  const { data: gap } = await db
    .from('v_cross_sell_gaps')
    .select('families_held, score')
    .eq('household_id', member.household_id)
    .maybeSingle()
  const families: string[] = Array.isArray(gap?.families_held) ? (gap!.families_held as string[]) : []
  const qualifying = families.find((f) => f !== 'life') ?? (hh?.referring_agency_id ? 'agency_relationship' : null)

  // Baseline = today deferred to the next allowed business day; the gate additionally enforces
  // recipient-local quiet hours (9am-8pm) at send time.
  const baseline = deferToBusinessDay(nowISO.slice(0, 10), {
    sendOnWeekends: campaign.send_on_weekends,
    sendOnHolidays: campaign.send_on_holidays,
    holidays: campaign.holiday_calendar,
  })
  const plan = computeTouchPlan(baseline)
  const firstDue = `${plan[0].dueDate}T13:00:00.000Z`

  const enrollTz = await enrollmentTimezoneFor(member.id, member.household_id)

  const { data: inserted, error } = await db
    .from('xsell_life_campaign_enrollments')
    .insert({
      campaign_id: campaign.id,
      campaign_version: campaign.version,
      household_id: member.household_id,
      member_id: member.id,
      agency_id: hh?.referring_agency_id ?? null,
      jurisdiction: hh?.state ?? null,
      qualifying_product: qualifying,
      status: 'running',
      previous_status: 'enrolled',
      baseline_date: baseline,
      current_touch_no: 0,
      next_touch_at: firstDue,
      lead_score: (gap?.score as number | null) ?? null,
      enrolled_by: input.actor,
      // Recipient-zone stamp for AUDIT/REPORTING only — dispatch resolves fresh every
      // send (mig 123). Unresolvable → omit, keeping the column default.
      ...(enrollTz ? { timezone: enrollTz } : {}),
      enrolled_at: nowISO,
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
    entity: 'xsell_life_campaign_enrollment',
    entityId: inserted?.id ?? null,
    diff: { campaign_id: campaign.id, version: campaign.version, household_id: member.household_id, member_id: member.id, force: !!input.forceOverride },
  })
  return { enrolled: true, enrollmentId: inserted?.id }
}

/** Manual removal (§5) — an audited exit event with a standardized reason. */
export async function removeEnrollment(input: { enrollmentId: string; actor: string; reason: string }): Promise<{ ok: boolean }> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const { data: cur } = await db.from('xsell_life_campaign_enrollments').select('status').eq('id', input.enrollmentId).maybeSingle()
  await db
    .from('xsell_life_campaign_enrollments')
    .update({ status: 'cancelled', previous_status: cur?.status ?? null, exit_reason: 'manual_removal', pause_reason: input.reason, completed_at: nowISO, updated_at: nowISO })
    .eq('id', input.enrollmentId)
    .not('status', 'in', '(completed,suppressed,cancelled,policy_issued,application_started,quote_requested,appointment_scheduled,purchased_elsewhere)')
  await writeAudit({
    actor: input.actor,
    action: 'entity.updated',
    entity: 'xsell_life_campaign_enrollment',
    entityId: input.enrollmentId,
    diff: { cancelled: true, prev: cur?.status ?? null, reason: input.reason },
  })
  return { ok: true }
}

export type { CampaignConfig }
