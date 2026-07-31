// src/lib/life-campaign/schedule.ts
// The Life Conversion Campaign's frozen 20-touch, 180-day cadence (spec §5) as PURE
// data + pure functions — no DB, no I/O, no ambient clock. This is the single source of
// truth for the timeline; the tick service and the seed migration both derive from it,
// so the schedule can never drift between what the DB seeds and what the runner expects.
//
// Timing model: day_offset is 1-based (Day 1 = the enrollment baseline date), matching
// the §5 table. A touch's calendar date is baseline + (day_offset - 1) days, computed in
// UTC-midnight math so it is stable regardless of server timezone; recipient-local
// quiet-hours are enforced later by the dispatcher gate, not here.

export type TouchKind = 'email' | 'sms' | 'ai_conversation' | 'advisor_outreach'

export interface TouchDef {
  touch_no: number
  day_offset: number
  kind: TouchKind
  /** The §5 asset label (informational; scheduling is driven by day_offset, not the label). */
  asset_label: string
}

// The exact §5 schedule. Order is the sequence order; day_offset is the authoritative
// timing (SMS template name day-numbers in §14 are informational labels and are ignored).
export const TOUCH_SCHEDULE: TouchDef[] = [
  { touch_no: 1, day_offset: 1, kind: 'email', asset_label: 'Email #1 — Conversion Opportunity Introduction' },
  { touch_no: 2, day_offset: 4, kind: 'sms', asset_label: 'SMS #1 — Initial Conversion Outreach' },
  { touch_no: 3, day_offset: 8, kind: 'ai_conversation', asset_label: 'Conversation Starter #1 — Initial Check-In' },
  { touch_no: 4, day_offset: 15, kind: 'email', asset_label: 'Email #2 — What Life Insurance Conversion Means' },
  { touch_no: 5, day_offset: 24, kind: 'sms', asset_label: 'SMS #2 — Conversion Education' },
  { touch_no: 6, day_offset: 35, kind: 'ai_conversation', asset_label: 'Conversation Starter #2 — Life Changes' },
  { touch_no: 7, day_offset: 48, kind: 'advisor_outreach', asset_label: 'Advisor Call Task #1' },
  { touch_no: 8, day_offset: 60, kind: 'email', asset_label: 'Email #3 — Life Changes and Coverage Needs' },
  { touch_no: 9, day_offset: 75, kind: 'sms', asset_label: 'SMS #3 — Coverage and Life-Change Check-In' },
  { touch_no: 10, day_offset: 90, kind: 'ai_conversation', asset_label: 'Conversation Starter #3 — Questions About Current Coverage' },
  { touch_no: 11, day_offset: 105, kind: 'email', asset_label: 'Email #4 — Common Conversion Questions' },
  { touch_no: 12, day_offset: 120, kind: 'sms', asset_label: 'SMS #4 — Conversion Questions Invitation' },
  { touch_no: 13, day_offset: 135, kind: 'advisor_outreach', asset_label: 'Advisor Call Task #2' },
  { touch_no: 14, day_offset: 145, kind: 'email', asset_label: 'Email #5 — Reasons to Review Conversion Options Now' },
  { touch_no: 15, day_offset: 152, kind: 'ai_conversation', asset_label: 'Conversation Starter #4 — Family Protection Check' },
  { touch_no: 16, day_offset: 158, kind: 'sms', asset_label: 'SMS #5 — Conversion Review Reminder' },
  { touch_no: 17, day_offset: 165, kind: 'email', asset_label: 'Email #6 — Conversion Window Follow-Up' },
  { touch_no: 18, day_offset: 171, kind: 'ai_conversation', asset_label: 'Conversation Starter #5 — Final Conversation Check-In' },
  { touch_no: 19, day_offset: 176, kind: 'sms', asset_label: 'SMS #6 — Final Conversion Reminder' },
  { touch_no: 20, day_offset: 180, kind: 'email', asset_label: 'Email #7 — Final Conversion Review Invitation' },
]

export interface PlannedTouch {
  touch_no: number
  kind: TouchKind
  /** ISO date (YYYY-MM-DD) this touch is due, relative to the baseline. */
  dueDate: string
}

const DAY_MS = 86400000

/** Parse an ISO date (YYYY-MM-DD) to a UTC-midnight epoch. Timezone-stable. */
function toUtcMidnight(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function toIsoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

/** Add whole days to an ISO date, returning an ISO date. */
export function addDays(isoDate: string, days: number): string {
  return toIsoDate(toUtcMidnight(isoDate) + days * DAY_MS)
}

/**
 * The full dated timeline for one enrollment, given its baseline (Day 1) date. Day N maps
 * to baseline + (N-1) days, so offsets are distinct → no two touches share a calendar day.
 */
export function computeTouchPlan(baselineISODate: string): PlannedTouch[] {
  const base = toUtcMidnight(baselineISODate)
  return TOUCH_SCHEDULE.map((tch) => ({
    touch_no: tch.touch_no,
    kind: tch.kind,
    dueDate: toIsoDate(base + (tch.day_offset - 1) * DAY_MS),
  }))
}

/**
 * The next touch strictly after the given cursor (0 = nothing sent yet → touch #1), or
 * null once the cursor has reached the final touch. Dated against the baseline.
 */
export function nextDueTouch(currentTouchNo: number, baselineISODate: string): PlannedTouch | null {
  const next = TOUCH_SCHEDULE.find((tch) => tch.touch_no > currentTouchNo)
  if (!next) return null
  return {
    touch_no: next.touch_no,
    kind: next.kind,
    dueDate: addDays(baselineISODate, next.day_offset - 1),
  }
}

/**
 * Whether a full 180-day run started at `baseline` completes with `bufferDays` of
 * operational headroom before the policy's verified conversion deadline. If false, the
 * contact must NOT be enrolled in the full campaign (route to a compressed/advisor path
 * per §5) — we never let the cadence run past the real deadline.
 */
export function earlyEnrollmentFits(deadlineISODate: string, baselineISODate: string, bufferDays: number): boolean {
  const lastTouch = toUtcMidnight(addDays(baselineISODate, 180 - 1))
  const latestSafe = toUtcMidnight(deadlineISODate) - bufferDays * DAY_MS
  return lastTouch <= latestSafe
}
