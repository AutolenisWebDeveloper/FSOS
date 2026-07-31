// src/lib/life-campaign/advisor.ts
// Advisor-outreach completion policy, PURE (no DB/clock). §5a treats advisor outreach as a
// real customer touch; §9a requires a due window, a reminder cadence, escalation, and a
// completion definition that requires a LOGGED outreach ATTEMPT — an advisor marking a task
// "done" with no attempt on record does not fulfil the touch. The campaign timeline does not
// stall on an incomplete advisor task (default option (b): proceed and log the touch as
// missed if it never gets an attempt); a missed advisor touch stays visible in analytics.

export type AdvisorTouchStatus = 'due' | 'overdue' | 'escalate' | 'reassign' | 'fulfilled' | 'missed'

export interface AdvisorTouchInput {
  /** When the advisor touch is due (ISO), tied to the scheduled touch day + contact tz. */
  dueAt: string
  now: string
  /** True once an actual outreach attempt (call placed/connected or personalized msg) is logged. */
  attemptLogged: boolean
  /** ISO timestamps of reminders already sent, to space the cadence. */
  remindersSent: string[]
  /** Hours past due before escalating to a manager/team lead (is_assumption). */
  overdueEscalateHours: number
  /** Hours past due before reassigning to another advisor (is_assumption). */
  reassignAfterHours: number
  /** Hours between reminders (default 24). */
  reminderIntervalHours?: number
}

export interface AdvisorTouchState {
  status: AdvisorTouchStatus
  /** When the next reminder should fire, or null when none is warranted. */
  nextReminderAt: string | null
}

const HOUR_MS = 3600000

function hoursBetween(aISO: string, bISO: string): number {
  return (Date.parse(aISO) - Date.parse(bISO)) / HOUR_MS
}

export function advisorTouchState(input: AdvisorTouchInput): AdvisorTouchState {
  // Completion requires a real attempt on record (§9a) — this wins over any clock state.
  if (input.attemptLogged) return { status: 'fulfilled', nextReminderAt: null }

  const hoursPastDue = hoursBetween(input.now, input.dueAt)
  const intervalH = input.reminderIntervalHours ?? 24

  if (hoursPastDue < 0) {
    // Not yet due — first reminder lands at the due time.
    return { status: 'due', nextReminderAt: input.dueAt }
  }

  let status: AdvisorTouchStatus = 'overdue'
  if (hoursPastDue >= input.reassignAfterHours) status = 'reassign'
  else if (hoursPastDue >= input.overdueEscalateHours) status = 'escalate'

  // Cadence: next reminder is one interval after the most recent reminder (or the due time).
  const lastReminder = input.remindersSent.length
    ? input.remindersSent[input.remindersSent.length - 1]
    : input.dueAt
  const nextReminderAt = new Date(Date.parse(lastReminder) + intervalH * HOUR_MS).toISOString()

  return { status, nextReminderAt }
}

/**
 * Whether the campaign timeline advances past an incomplete advisor task. Default 'proceed'
 * (§9a option (b)) so a stalled advisor task never freezes the client's cadence; 'hold'
 * blocks downstream touches until the advisor task is fulfilled or times out.
 */
export function campaignProceedsPastAdvisor(behavior: 'proceed' | 'hold'): boolean {
  return behavior === 'proceed'
}
