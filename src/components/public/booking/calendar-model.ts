// src/components/public/booking/calendar-model.ts
// PURE, dependency-free month/selection model shared by the booking picker AND the reschedule
// picker. Extracted so the today-floor, the "never request the past" fetch anchor, the
// in-month earliest-available selection, and the initial-month choice have ONE tested
// implementation — the reschedule flow reuses the exact logic rather than re-deriving it.
// No React, no clock, no network → unit-provable in isolation.

export interface MonthCursor {
  year: number
  month0: number // 0-based month (0 = January)
}

/** The month a YYYY-MM-DD key falls in. */
export function monthOf(dateKey: string): MonthCursor {
  return { year: Number(dateKey.slice(0, 4)), month0: Number(dateKey.slice(5, 7)) - 1 }
}

/** First day (YYYY-MM-DD) of the cursor's month. */
export function firstOfMonthKey(c: MonthCursor): string {
  const mm = String(c.month0 + 1).padStart(2, '0')
  return `${c.year}-${mm}-01`
}

/** "YYYY-MM" prefix of the cursor's month (for in-month key filtering). */
export function monthPrefixOf(c: MonthCursor): string {
  return firstOfMonthKey(c).slice(0, 7)
}

/** Shift a month cursor by whole months (handles year rollover in both directions). */
export function addMonths(c: MonthCursor, delta: number): MonthCursor {
  const abs = c.year * 12 + c.month0 + delta
  return { year: Math.floor(abs / 12), month0: ((abs % 12) + 12) % 12 }
}

/**
 * The `from` date to request availability for a visible month: the LATER of the month's first
 * day and today, so we never ask the engine for past days. Identical for booking and reschedule.
 */
export function fetchFromKey(cursor: MonthCursor, todayKey: string): string {
  const first = firstOfMonthKey(cursor)
  return first > todayKey ? first : todayKey
}

/**
 * The earliest open day (YYYY-MM-DD) that falls IN the given month, or null if none. Scoped to
 * the month because a single availability fetch can span into the next month (those days render
 * as trailing, non-selectable calendar cells and must never become the auto-selection).
 */
export function firstOpenDayInMonth(dayKeys: Iterable<string>, monthPrefix: string): string | null {
  const inMonth = [...dayKeys].filter((k) => k.startsWith(monthPrefix)).sort()
  return inMonth[0] ?? null
}

/**
 * Which month the picker opens on.
 *  - Booking (no anchor): the current month.
 *  - Reschedule (anchor = the existing appointment's local day): the appointment's month when it
 *    is in the FUTURE — so the booker lands where their current time is and can page back to
 *    today or forward — but never a month before today (you cannot reschedule into the past).
 * The distinction is exactly why this can't be assumed identical to the booking flow.
 */
export function initialMonth(todayKey: string, anchorKey?: string | null): MonthCursor {
  const base = anchorKey && anchorKey > todayKey ? anchorKey : todayKey
  return monthOf(base)
}

/** Whether the picker may page to the previous month (today's month is the floor). */
export function canGoToPrevMonth(cursor: MonthCursor, todayKey: string): boolean {
  const today = monthOf(todayKey)
  return cursor.year * 12 + cursor.month0 > today.year * 12 + today.month0
}
