// src/lib/cross-sell-life/schedule.ts
// The Cross-Sell Life Campaign's frozen 35-touch, 180-day cadence (spec §6) as PURE data +
// pure functions — no DB, no I/O, no ambient clock. Single source of truth for the timeline;
// the tick service and the seed migration (086) both derive from it, so the schedule can never
// drift between what the DB seeds and what the runner expects.
//
// Timing model: day_offset is 1-based (Day 1 = the enrollment baseline date), matching the §6
// table. A touch's calendar date is baseline + (day_offset - 1) days, computed in UTC-midnight
// math so it is stable regardless of server timezone; recipient-local quiet hours (9am-8pm) are
// enforced later by the dispatcher gate, not here. Business-day / weekend / holiday deferral is a
// pure helper (deferToBusinessDay) the enroll/tick services apply when placing next_touch_at.
//
// The §6 spacing intentionally tapers from ~6 days to 4- and 2-day intervals for touches 30-35
// (days 166-180). Day numbers are implemented EXACTLY as listed — NOT normalized (spec §6 note).

export type TouchKind = 'email' | 'sms' | 'ai_conversation' | 'advisor_outreach'

export interface TouchDef {
  touch_no: number
  day_offset: number
  kind: TouchKind
  /** The §6 asset label (informational; scheduling is driven by day_offset, not the label). */
  asset_label: string
}

// The exact §6 schedule. Order is the sequence order; day_offset is the authoritative timing.
export const TOUCH_SCHEDULE: TouchDef[] = [
  { touch_no: 1,  day_offset: 1,   kind: 'email',           asset_label: 'Email 1 — Thank You for Being Our Client' },
  { touch_no: 2,  day_offset: 3,   kind: 'sms',             asset_label: 'SMS 1 — Client Appreciation' },
  { touch_no: 3,  day_offset: 7,   kind: 'ai_conversation', asset_label: 'AI 1 — Existing Client Welcome' },
  { touch_no: 4,  day_offset: 12,  kind: 'email',           asset_label: 'Email 2 — Have You Reviewed Your Life Coverage?' },
  { touch_no: 5,  day_offset: 18,  kind: 'sms',             asset_label: 'SMS 2 — Complimentary Protection Review' },
  { touch_no: 6,  day_offset: 24,  kind: 'advisor_outreach',asset_label: 'Advisor 1 — Relationship Check-In' },
  { touch_no: 7,  day_offset: 30,  kind: 'email',           asset_label: 'Email 3 — Life Changes' },
  { touch_no: 8,  day_offset: 36,  kind: 'sms',             asset_label: 'SMS 3 — Life Changes' },
  { touch_no: 9,  day_offset: 42,  kind: 'ai_conversation', asset_label: 'AI 2 — Life-Change Discovery' },
  { touch_no: 10, day_offset: 48,  kind: 'email',           asset_label: 'Email 4 — Life Insurance Myths' },
  { touch_no: 11, day_offset: 54,  kind: 'sms',             asset_label: 'SMS 4 — Affordability' },
  { touch_no: 12, day_offset: 60,  kind: 'email',           asset_label: 'Email 5 — Protecting Income and Family' },
  { touch_no: 13, day_offset: 66,  kind: 'ai_conversation', asset_label: 'AI 3 — Protection Discovery' },
  { touch_no: 14, day_offset: 72,  kind: 'sms',             asset_label: 'SMS 5 — Family Protection' },
  { touch_no: 15, day_offset: 78,  kind: 'email',           asset_label: 'Email 6 — Employer Coverage' },
  { touch_no: 16, day_offset: 84,  kind: 'advisor_outreach',asset_label: 'Advisor 2 — Needs Discovery' },
  { touch_no: 17, day_offset: 90,  kind: 'sms',             asset_label: 'SMS 6 — Employer Coverage' },
  { touch_no: 18, day_offset: 96,  kind: 'ai_conversation', asset_label: 'AI 4 — Existing Coverage Review' },
  { touch_no: 19, day_offset: 102, kind: 'email',           asset_label: 'Email 7 — Understanding Coverage Needs' },
  { touch_no: 20, day_offset: 108, kind: 'sms',             asset_label: 'SMS 7 — Coverage Questions' },
  { touch_no: 21, day_offset: 114, kind: 'email',           asset_label: 'Email 8 — Why People Wait' },
  { touch_no: 22, day_offset: 120, kind: 'sms',             asset_label: 'SMS 8 — No-Pressure Review' },
  { touch_no: 23, day_offset: 126, kind: 'ai_conversation', asset_label: 'AI 5 — Objection Handling' },
  { touch_no: 24, day_offset: 132, kind: 'email',           asset_label: 'Email 9 — Complimentary Protection Review' },
  { touch_no: 25, day_offset: 138, kind: 'sms',             asset_label: 'SMS 9 — Schedule a Review' },
  { touch_no: 26, day_offset: 144, kind: 'advisor_outreach',asset_label: 'Advisor 3 — Personal Review Invitation' },
  { touch_no: 27, day_offset: 150, kind: 'email',           asset_label: 'Email 10 — Build a Protection Plan' },
  { touch_no: 28, day_offset: 156, kind: 'sms',             asset_label: 'SMS 10 — Request Information' },
  { touch_no: 29, day_offset: 162, kind: 'ai_conversation', asset_label: 'AI 6 — Scheduling and Next Steps' },
  { touch_no: 30, day_offset: 166, kind: 'email',           asset_label: 'Email 11 — We Are Here When You Are Ready' },
  { touch_no: 31, day_offset: 170, kind: 'sms',             asset_label: 'SMS 11 — Still Interested?' },
  { touch_no: 32, day_offset: 174, kind: 'advisor_outreach',asset_label: 'Advisor 4 — Final Personal Outreach' },
  { touch_no: 33, day_offset: 176, kind: 'email',           asset_label: 'Email 12 — Final Follow-Up' },
  { touch_no: 34, day_offset: 178, kind: 'sms',             asset_label: 'SMS 12 — Final Check-In' },
  { touch_no: 35, day_offset: 180, kind: 'ai_conversation', asset_label: 'AI 7 — Respectful Close or Future Follow-Up' },
]

// Invariants (asserted by unit tests): 35 touches, 12 email + 12 sms + 7 ai + 4 advisor,
// strictly increasing distinct day_offsets, last touch on day 180.
export const TOTAL_TOUCHES = TOUCH_SCHEDULE.length // 35
export const CAMPAIGN_DAYS = 180

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
 * The next touch strictly after the given cursor (0 = nothing sent yet → touch #1), or null once
 * the cursor has reached the final touch. Dated against the baseline.
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

/** Day-of-week for an ISO date in UTC-stable terms (0 = Sunday … 6 = Saturday). */
export function isoWeekday(isoDate: string): number {
  return new Date(toUtcMidnight(isoDate)).getUTCDay()
}

export interface BusinessDayConfig {
  sendOnWeekends: boolean
  sendOnHolidays: boolean
  /** ISO dates (YYYY-MM-DD) treated as holidays. */
  holidays: string[]
}

/**
 * Push an ISO date forward to the next allowed business day, honoring weekend + holiday config
 * (§6 timing rules / § Settings). Pure — the tick/enroll services call this when placing
 * next_touch_at so a proactive touch never lands on a suppressed calendar day. Bounded loop
 * (max 14 forward steps) so a misconfigured all-holidays list can never spin.
 */
export function deferToBusinessDay(isoDate: string, cfg: BusinessDayConfig): string {
  const holidays = new Set(cfg.holidays.map((h) => h.slice(0, 10)))
  let d = isoDate.slice(0, 10)
  for (let i = 0; i < 14; i++) {
    const wd = isoWeekday(d)
    const isWeekend = wd === 0 || wd === 6
    const isHoliday = holidays.has(d)
    if ((isWeekend && !cfg.sendOnWeekends) || (isHoliday && !cfg.sendOnHolidays)) {
      d = addDays(d, 1)
      continue
    }
    return d
  }
  return d
}
