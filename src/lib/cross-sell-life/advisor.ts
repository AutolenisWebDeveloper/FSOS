// src/lib/cross-sell-life/advisor.ts
// Advisor-outreach completion policy, PURE (no DB/clock). §10 treats advisor outreach as a real
// customer touch requiring a due window, a reminder cadence, escalation, reassignment, and a
// completion definition that requires a LOGGED outreach ATTEMPT — an advisor marking a task "done"
// with no attempt on record does not fulfil the touch. The campaign timeline does not stall on an
// incomplete advisor task (default 'proceed': log the touch as missed if it never gets an attempt);
// a missed advisor touch stays visible in analytics.

export type AdvisorTouchStatus = 'due' | 'overdue' | 'escalate' | 'reassign' | 'fulfilled' | 'missed'

export interface AdvisorTouchInput {
  dueAt: string
  now: string
  attemptLogged: boolean
  remindersSent: string[]
  overdueEscalateHours: number
  reassignAfterHours: number
  reminderIntervalHours?: number
}
export interface AdvisorTouchState {
  status: AdvisorTouchStatus
  nextReminderAt: string | null
}

const HOUR_MS = 3600000
function hoursBetween(aISO: string, bISO: string): number {
  return (Date.parse(aISO) - Date.parse(bISO)) / HOUR_MS
}

export function advisorTouchState(input: AdvisorTouchInput): AdvisorTouchState {
  // Completion requires a real attempt on record (§10) — this wins over any clock state.
  if (input.attemptLogged) return { status: 'fulfilled', nextReminderAt: null }

  const hoursPastDue = hoursBetween(input.now, input.dueAt)
  const intervalH = input.reminderIntervalHours ?? 24

  if (hoursPastDue < 0) return { status: 'due', nextReminderAt: input.dueAt }

  let status: AdvisorTouchStatus = 'overdue'
  if (hoursPastDue >= input.reassignAfterHours) status = 'reassign'
  else if (hoursPastDue >= input.overdueEscalateHours) status = 'escalate'

  const lastReminder = input.remindersSent.length ? input.remindersSent[input.remindersSent.length - 1] : input.dueAt
  const nextReminderAt = new Date(Date.parse(lastReminder) + intervalH * HOUR_MS).toISOString()
  return { status, nextReminderAt }
}

/** Whether the campaign timeline advances past an incomplete advisor task (§10 default 'proceed'). */
export function campaignProceedsPastAdvisor(behavior: 'proceed' | 'hold'): boolean {
  return behavior === 'proceed'
}
