// src/lib/appointments/recovery.ts
// The PURE core of appointment lifecycle + no-show recovery (§13.4). Deliberately
// DB-free (imports nothing) so the status state-machine, overdue detection, the
// appointment funnel, and no-show recovery planning are unit-provable in isolation —
// the same discipline as the opportunity planners.
//
// FSOS has an `appointments` table (status scheduled/completed/cancelled/no_show) but
// nothing ever advanced an appointment past 'scheduled': no lifecycle, no no-show
// detection, no recovery. This closes that gap. It does NOT fabricate a calendar
// integration (none is verified — §4.3); appointments remain manually entered / created
// from a review, and this layer manages their lifecycle and recovers no-shows.
//
// GUARDRAILS baked in here:
//   • Green-zone only — a recovery draft is an INTERNAL reschedule follow-up task, never
//     a client-facing send and never a product recommendation. Any outreach that results
//     still flows through the workforce + the 7-step gate.
//   • Honest metrics — the funnel show-rate is completed / (completed + no_show); it is
//     never inflated and returns 0 when nothing has been held yet (§32: 0 ≠ no data).

/** The appointments.status enum (mig 009) — kept in lock-step with the DB CHECK. */
export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

/** A row of appointments (the columns the core needs). */
export interface Appointment {
  id: string
  household_id: string | null
  opportunity_id: string | null
  scheduled_at: string | null
  status: string
}

// Allowed status transitions. A held meeting is completed; a missed one is a no_show; a
// no_show or cancelled meeting can be rescheduled back to 'scheduled' (recovery). A
// completed appointment is terminal. Same-state is a no-op, not a transition.
const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['completed', 'cancelled', 'no_show'],
  no_show: ['scheduled'],
  cancelled: ['scheduled'],
  completed: [],
}

function isStatus(s: string): s is AppointmentStatus {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(s)
}

/** True only for an allowed, non-no-op status transition. */
export function canTransition(from: string, to: string): boolean {
  if (!isStatus(from) || !isStatus(to)) return false
  return TRANSITIONS[from].includes(to)
}

/**
 * An appointment is "overdue" when it is still 'scheduled' but its time has passed —
 * it needs a human decision (mark completed or no_show). `now` is passed in for
 * testability (never read the clock inside a pure function).
 */
export function isOverdue(appt: Appointment, now: Date): boolean {
  if (appt.status !== 'scheduled' || !appt.scheduled_at) return false
  const when = new Date(appt.scheduled_at)
  return !Number.isNaN(when.getTime()) && when.getTime() < now.getTime()
}

/** Recovery applies to a no-show (a missed, un-recovered meeting). */
export function needsRecovery(appt: Appointment): boolean {
  return appt.status === 'no_show'
}

export interface AppointmentFunnel {
  scheduled: number
  completed: number
  cancelled: number
  noShow: number
  total: number
  /** completed / (completed + no_show), as an integer percent; 0 when none held. */
  showRate: number
}

/** Count appointments by status and compute an honest show-rate (§32). */
export function appointmentFunnel(appts: Appointment[]): AppointmentFunnel {
  let scheduled = 0
  let completed = 0
  let cancelled = 0
  let noShow = 0
  for (const a of appts) {
    if (a.status === 'scheduled') scheduled += 1
    else if (a.status === 'completed') completed += 1
    else if (a.status === 'cancelled') cancelled += 1
    else if (a.status === 'no_show') noShow += 1
  }
  const held = completed + noShow
  const showRate = held > 0 ? Math.round((completed / held) * 100) : 0
  return { scheduled, completed, cancelled, noShow, total: appts.length, showRate }
}

export interface RecoveryDraft {
  appointment_id: string
  household_id: string | null
  opportunity_id: string | null
  reason: string
}

export interface RecoveryPlan {
  drafts: RecoveryDraft[]
  skipped: { appointment_id: string; reason: 'not_a_no_show' | 'already_recovered' }[]
}

/** A green-zone, internal reschedule reason — never a recommendation or a CTA. */
export function recoveryReason(): string {
  return 'Missed appointment (no-show) — reschedule follow-up.'
}

/**
 * Plan one recovery task per un-recovered no-show. `existingRecoveryApptIds` is the set
 * of appointment ids that already carry an open recovery task (dedup). Also dedups
 * within the batch. Non-no-show appointments are skipped.
 */
export function planNoShowRecovery(
  appts: Appointment[],
  existingRecoveryApptIds: string[],
): RecoveryPlan {
  const recovered = new Set(existingRecoveryApptIds)
  const drafts: RecoveryDraft[] = []
  const skipped: RecoveryPlan['skipped'] = []
  const plannedThisBatch = new Set<string>()

  for (const a of appts) {
    if (!needsRecovery(a)) {
      skipped.push({ appointment_id: a.id, reason: 'not_a_no_show' })
      continue
    }
    if (recovered.has(a.id) || plannedThisBatch.has(a.id)) {
      skipped.push({ appointment_id: a.id, reason: 'already_recovered' })
      continue
    }
    plannedThisBatch.add(a.id)
    drafts.push({
      appointment_id: a.id,
      household_id: a.household_id,
      opportunity_id: a.opportunity_id,
      reason: recoveryReason(),
    })
  }

  return { drafts, skipped }
}
