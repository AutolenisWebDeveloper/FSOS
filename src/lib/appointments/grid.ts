// src/lib/appointments/grid.ts
// PURE, dependency-free date helpers for the internal appointment WEEK grid + calendar navigation.
// The MONTH matrix is already solved by the public booking module (components/public/booking/
// month-grid: buildMonthMatrix/dateKeyOf/dayState) and is reused as-is — this file adds only the
// week layout and the prev/next navigation math that module doesn't have, so there is no duplicate
// month-grid implementation. All keys are zero-padded YYYY-MM-DD; comparisons are string-safe.

export interface YMD {
  year: number
  month0: number
  day: number
}

/** Parse a YYYY-MM-DD key into calendar parts (layout only — no timezone). */
export function parseDateKey(key: string): YMD {
  const [y, m, d] = key.split('-').map((n) => Number.parseInt(n, 10))
  return { year: y, month0: m - 1, day: d }
}

/** Weekday of a date key, 0=Sun … 6=Sat, computed in UTC (layout only). */
export function weekdayOf(key: string): number {
  const { year, month0, day } = parseDateKey(key)
  return new Date(Date.UTC(year, month0, day)).getUTCDay()
}

/** Shift a date key by whole days (UTC; correctly crosses month/year boundaries). */
export function addDaysKey(key: string, delta: number): string {
  const { year, month0, day } = parseDateKey(key)
  return new Date(Date.UTC(year, month0, day + delta)).toISOString().slice(0, 10)
}

/**
 * The Sunday-start week (7 date keys) that contains `anchorKey`. Stable width so week navigation
 * never jumps. Reuses weekdayOf to find the week's Sunday, then walks 7 days.
 */
export function buildWeekDays(anchorKey: string): string[] {
  const start = addDaysKey(anchorKey, -weekdayOf(anchorKey))
  return Array.from({ length: 7 }, (_, i) => addDaysKey(start, i))
}

/** Add/subtract months, normalizing the year. Day is intentionally dropped (month views key off
 *  year+month0). */
export function addMonths(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 }
}
