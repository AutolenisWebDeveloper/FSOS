// src/lib/district-nurture/schedule.ts
// PURE 40-touch / 365-day cadence for the District Agent FS Nurture Campaign ("The
// Second Conversation", ADR-038). Single source of truth for the timeline.
//
// SELF-CONTAINED by design (own date helpers, NO imports) so the isolated-compile unit
// test (tests/district-nurture-schedule.test.mjs) can `tsc` this one file alone and
// require it — the same brittle-but-deliberate pattern as the other campaign schedules
// (ADR-031 §3). The ~15 lines of UTC-midnight date math are duplicated on purpose.
//
// CURRICULUM MODEL (ADR-038 §5): 12 SEQUENTIAL modules relative to the enrollment
// baseline (module m fires in campaign-month m — never reordered by calendar). Each
// module = Email A (concept/signal) + SMS (nudge) + Email B (say-it + hand-off). Four
// quarterly LIVE touchpoints (advisor_outreach) close each quarter. Seasonal intent
// (LIAM, tax-season money-in-motion) is a calendar OVERLAY (see playbooks.ts
// CALENDAR_OVERLAYS + the scheduled activation task), never a mutation of this order.

export type TouchKind = 'email' | 'sms' | 'ai_conversation' | 'advisor_outreach'

export interface TouchDef {
  touch_no: number
  /** Curriculum module 1-12; null for the cross-module quarterly live touchpoints. */
  module_no: number | null
  day_offset: number
  kind: TouchKind
  asset_label: string
}

/** 24 email + 12 sms + 4 advisor_outreach = 40 touches over 365 days. */
export const TOUCH_SCHEDULE: TouchDef[] = [
  { touch_no: 1, module_no: 1, day_offset: 1, kind: 'email', asset_label: 'M1 Email A — Financial foundations' },
  { touch_no: 2, module_no: 1, day_offset: 10, kind: 'sms', asset_label: 'M1 SMS — Notice the signal' },
  { touch_no: 3, module_no: 1, day_offset: 20, kind: 'email', asset_label: 'M1 Email B — From signal to introduction' },
  { touch_no: 4, module_no: 2, day_offset: 31, kind: 'email', asset_label: 'M2 Email A — Reserves and debt' },
  { touch_no: 5, module_no: 2, day_offset: 40, kind: 'sms', asset_label: 'M2 SMS — Reserves and debt' },
  { touch_no: 6, module_no: 2, day_offset: 50, kind: 'email', asset_label: 'M2 Email B — Handing off the money conversation' },
  { touch_no: 7, module_no: 3, day_offset: 61, kind: 'email', asset_label: 'M3 Email A — Retirement, starting with you' },
  { touch_no: 8, module_no: 3, day_offset: 70, kind: 'sms', asset_label: 'M3 SMS — Someday' },
  { touch_no: 9, module_no: 3, day_offset: 80, kind: 'email', asset_label: 'M3 Email B — Retirement signals' },
  { touch_no: 10, module_no: null, day_offset: 90, kind: 'advisor_outreach', asset_label: 'Q1 Live Touchpoint — Quarterly partnership call' },
  { touch_no: 11, module_no: 4, day_offset: 91, kind: 'email', asset_label: 'M4 Email A — Home and household protection' },
  { touch_no: 12, module_no: 4, day_offset: 100, kind: 'sms', asset_label: 'M4 SMS — New home' },
  { touch_no: 13, module_no: 4, day_offset: 110, kind: 'email', asset_label: 'M4 Email B — Refinance and closing handoff' },
  { touch_no: 14, module_no: 5, day_offset: 121, kind: 'email', asset_label: 'M5 Email A — When the family grows' },
  { touch_no: 15, module_no: 5, day_offset: 130, kind: 'sms', asset_label: 'M5 SMS — Growing family' },
  { touch_no: 16, module_no: 5, day_offset: 140, kind: 'email', asset_label: 'M5 Email B — Introducing the family review' },
  { touch_no: 17, module_no: 6, day_offset: 151, kind: 'email', asset_label: 'M6 Email A — What an FNA is' },
  { touch_no: 18, module_no: 6, day_offset: 160, kind: 'sms', asset_label: 'M6 SMS — The FNA' },
  { touch_no: 19, module_no: 6, day_offset: 170, kind: 'email', asset_label: 'M6 Email B — Teeing up the FNA' },
  { touch_no: 20, module_no: null, day_offset: 180, kind: 'advisor_outreach', asset_label: 'Q2 Live Touchpoint — Mid-year FNA workshop' },
  { touch_no: 21, module_no: 7, day_offset: 181, kind: 'email', asset_label: 'M7 Email A — Business-owner clients' },
  { touch_no: 22, module_no: 7, day_offset: 190, kind: 'sms', asset_label: 'M7 SMS — Business owners' },
  { touch_no: 23, module_no: 7, day_offset: 200, kind: 'email', asset_label: 'M7 Email B — Introducing a business review' },
  { touch_no: 24, module_no: 8, day_offset: 211, kind: 'email', asset_label: 'M8 Email A — The life insurance family' },
  { touch_no: 25, module_no: 8, day_offset: 220, kind: 'sms', asset_label: 'M8 SMS — Which one' },
  { touch_no: 26, module_no: 8, day_offset: 230, kind: 'email', asset_label: 'M8 Email B — Which one is not your call' },
  { touch_no: 27, module_no: 9, day_offset: 241, kind: 'email', asset_label: 'M9 Email A — Protection planning and LIAM' },
  { touch_no: 28, module_no: 9, day_offset: 250, kind: 'sms', asset_label: 'M9 SMS — LIAM' },
  { touch_no: 29, module_no: 9, day_offset: 260, kind: 'email', asset_label: 'M9 Email B — Awareness-month introduction' },
  { touch_no: 30, module_no: null, day_offset: 270, kind: 'advisor_outreach', asset_label: 'Q3 Live Touchpoint — LIAM referral push review' },
  { touch_no: 31, module_no: 10, day_offset: 271, kind: 'email', asset_label: 'M10 Email A — Money in motion' },
  { touch_no: 32, module_no: 10, day_offset: 280, kind: 'sms', asset_label: 'M10 SMS — Money in motion' },
  { touch_no: 33, module_no: 10, day_offset: 290, kind: 'email', asset_label: 'M10 Email B — The immediate hand-off' },
  { touch_no: 34, module_no: 11, day_offset: 301, kind: 'email', asset_label: 'M11 Email A — Turning savings into a paycheck' },
  { touch_no: 35, module_no: 11, day_offset: 310, kind: 'sms', asset_label: 'M11 SMS — Guaranteed' },
  { touch_no: 36, module_no: 11, day_offset: 320, kind: 'email', asset_label: 'M11 Email B — Income-conversation handoff' },
  { touch_no: 37, module_no: 12, day_offset: 331, kind: 'email', asset_label: 'M12 Email A — Beneficiaries and legacy' },
  { touch_no: 38, module_no: 12, day_offset: 340, kind: 'sms', asset_label: 'M12 SMS — Beneficiaries' },
  { touch_no: 39, module_no: 12, day_offset: 350, kind: 'email', asset_label: 'M12 Email B — A standing partnership' },
  { touch_no: 40, module_no: null, day_offset: 365, kind: 'advisor_outreach', asset_label: 'Q4 Live Touchpoint — Annual review and next-year plan' },
]

export const CAMPAIGN_LENGTH_DAYS = 365

export interface PlannedTouch {
  touch_no: number
  module_no: number | null
  kind: TouchKind
  dueDate: string
}

// ── Date math (UTC-midnight, timezone-stable). Duplicated per campaign by design. ──
const DAY_MS = 86400000

function toUtcMidnight(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
function toIsoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}
export function addDays(isoDate: string, days: number): string {
  return toIsoDate(toUtcMidnight(isoDate) + days * DAY_MS)
}

/** Calendar date for every touch: baseline + (day_offset - 1) days (Day 1 = baseline). */
export function computeTouchPlan(baselineISODate: string): PlannedTouch[] {
  const base = toUtcMidnight(baselineISODate)
  return TOUCH_SCHEDULE.map((t) => ({
    touch_no: t.touch_no,
    module_no: t.module_no,
    kind: t.kind,
    dueDate: toIsoDate(base + (t.day_offset - 1) * DAY_MS),
  }))
}

/** The first touch after `currentTouchNo`, dated from the baseline. Null when finished. */
export function nextDueTouch(currentTouchNo: number, baselineISODate: string): PlannedTouch | null {
  const next = TOUCH_SCHEDULE.find((t) => t.touch_no > currentTouchNo)
  if (!next) return null
  return {
    touch_no: next.touch_no,
    module_no: next.module_no,
    kind: next.kind,
    dueDate: addDays(baselineISODate, next.day_offset - 1),
  }
}

/** Total proactive touches (used by analytics + registry cross-checks). */
export const TOTAL_TOUCHES = TOUCH_SCHEDULE.length
