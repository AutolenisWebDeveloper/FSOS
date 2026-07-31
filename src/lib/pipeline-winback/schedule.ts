// src/lib/pipeline-winback/schedule.ts
// The Pipeline Win-Back Campaign's frozen 24-touch, 120-day cadence (spec §6/§7) as PURE
// data + pure functions — no DB, no I/O, no ambient clock. Single source of truth for the
// timeline; the tick service and the seed migration both derive from it, so the schedule can
// never drift between what the DB seeds and what the runner expects.
//
// Owner-confirmed 2026-07-31 (ADR-031, spec §0.7 checkpoint 1): the campaign is 120 days,
// with the drafted Day 125–140 tail compressed into Days 90–120 so all 24 touches fit inside
// the window. Days 90–120 are the accelerated phase (touches 13–24): shorter intervals,
// alternating channels, higher advisor visibility.
//
// Kept SELF-CONTAINED (its own date helpers, no imports) so the isolated-compile unit test
// (tests/pipeline-winback-schedule.test.mjs) mirrors the life-campaign schedule test exactly.
// The ~15 lines of date math are the one acknowledged, non-substantive duplication (ADR-031 §3).
//
// Timing model: day_offset is 1-based (Day 1 = the enrollment baseline date), matching the §7
// table. A touch's calendar date is baseline + (day_offset - 1) days, computed in UTC-midnight
// math so it is stable regardless of server timezone; recipient-local quiet-hours are enforced
// later by the dispatcher gate, not here.

export type TouchKind = 'email' | 'sms' | 'ai_conversation' | 'advisor_outreach'

export interface TouchDef {
  touch_no: number
  day_offset: number
  kind: TouchKind
  /** The §7 asset label (informational; scheduling is driven by day_offset, not the label). */
  asset_label: string
}

// The exact §7 schedule (120 days, 24 touches). Order is the sequence order; day_offset is the
// authoritative timing. SMS template name day-numbers in §8 are informational labels, ignored.
export const TOUCH_SCHEDULE: TouchDef[] = [
  { touch_no: 1, day_offset: 1, kind: 'email', asset_label: 'Email #1 — Welcome Back' },
  { touch_no: 2, day_offset: 3, kind: 'sms', asset_label: 'SMS #1 — Welcome Back / Reconnect' },
  { touch_no: 3, day_offset: 7, kind: 'ai_conversation', asset_label: 'Playbook #1 — Reconnect' },
  { touch_no: 4, day_offset: 14, kind: 'email', asset_label: 'Email #2 — Life Changes' },
  { touch_no: 5, day_offset: 18, kind: 'sms', asset_label: 'SMS #2 — Life Changes' },
  { touch_no: 6, day_offset: 25, kind: 'ai_conversation', asset_label: 'Playbook #2 — Life Changes Discovery' },
  { touch_no: 7, day_offset: 35, kind: 'email', asset_label: 'Email #3 — Common Life Insurance Myths' },
  { touch_no: 8, day_offset: 42, kind: 'advisor_outreach', asset_label: 'Advisor Script #1 — Relationship Reconnect' },
  { touch_no: 9, day_offset: 49, kind: 'sms', asset_label: 'SMS #3 — Cost / Affordability' },
  { touch_no: 10, day_offset: 60, kind: 'email', asset_label: 'Email #4 — Protect What Matters Most' },
  { touch_no: 11, day_offset: 70, kind: 'ai_conversation', asset_label: 'Playbook #3 — Objection Handling' },
  { touch_no: 12, day_offset: 80, kind: 'sms', asset_label: 'SMS #4 — Protection' },
  // ── Accelerated phase (Days 90–120, touches 13–24): alternating channels, no repeats ──
  { touch_no: 13, day_offset: 90, kind: 'email', asset_label: 'Email #5 — Understanding Coverage Needs' },
  { touch_no: 14, day_offset: 93, kind: 'advisor_outreach', asset_label: 'Advisor Script #2 — Final Personal Follow-Up' },
  { touch_no: 15, day_offset: 96, kind: 'sms', asset_label: 'SMS #5 — Complimentary Review' },
  { touch_no: 16, day_offset: 99, kind: 'ai_conversation', asset_label: 'Playbook #4 — Life Insurance Education' },
  { touch_no: 17, day_offset: 102, kind: 'email', asset_label: 'Email #6 — Why People Wait' },
  { touch_no: 18, day_offset: 105, kind: 'sms', asset_label: 'SMS #6 — Still Interested?' },
  { touch_no: 19, day_offset: 108, kind: 'email', asset_label: 'Email #7 — Complimentary Policy Review' },
  { touch_no: 20, day_offset: 111, kind: 'sms', asset_label: 'SMS #7 — Questions?' },
  { touch_no: 21, day_offset: 114, kind: 'ai_conversation', asset_label: 'Playbook #5 — Scheduling & Next Steps' },
  { touch_no: 22, day_offset: 117, kind: 'email', asset_label: 'Email #8 — Final Follow-Up' },
  { touch_no: 23, day_offset: 119, kind: 'sms', asset_label: 'SMS #8 — Final Check-In' },
  { touch_no: 24, day_offset: 120, kind: 'ai_conversation', asset_label: 'Playbook #6 — Respectful Final Outreach' },
]

/** The last scheduled day of the campaign (Day 120). */
export const CAMPAIGN_LENGTH_DAYS = 120

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
 * The full dated timeline for one enrollment, given its baseline (Day 1) date. Day N maps to
 * baseline + (N-1) days, so offsets are distinct → no two touches share a calendar day.
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
 * The next touch strictly after the given cursor (0 = nothing sent yet → touch #1), or null
 * once the cursor has reached the final touch. Dated against the baseline.
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
