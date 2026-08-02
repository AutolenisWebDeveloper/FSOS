// src/components/public/booking/month-grid.ts
// PURE, dependency-free helpers for the public booking month calendar (P1). No React, no
// clock, no timezone math — the availability API already returns a per-slot `localDate`
// (YYYY-MM-DD in the booker's chosen zone), so this module only lays out the calendar grid
// and classifies each day. Unit-provable in isolation (compiled standalone and required).

export interface MonthCell {
  /** YYYY-MM-DD for the cell (always a real calendar date). */
  dateKey: string
  /** Day of month, 1–31. */
  day: number
  /** True when the date belongs to the displayed month (false for leading/trailing fillers). */
  inMonth: boolean
}

export type DayState = 'available' | 'unavailable' | 'past'

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** YYYY-MM-DD from calendar parts (no Date/timezone — layout only). */
export function dateKeyOf(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`
}

/** Days in a given month (month0 is 0-based). */
export function daysInMonth(year: number, month0: number): number {
  // Day 0 of the next month is the last day of this month. UTC avoids any local-zone drift.
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/** Weekday (0=Sun … 6=Sat) of the first of the month, computed in UTC (layout only). */
export function firstWeekday(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0, 1)).getUTCDay()
}

/**
 * A 6×7, Sunday-start calendar matrix for the given month. Always 6 rows so the grid height
 * is stable across months (no layout jump when navigating). Leading/trailing cells carry the
 * real neighboring-month dates with `inMonth: false`.
 */
export function buildMonthMatrix(year: number, month0: number): MonthCell[][] {
  const lead = firstWeekday(year, month0)
  const total = daysInMonth(year, month0)
  const prevTotal = daysInMonth(month0 === 0 ? year - 1 : year, (month0 + 11) % 12)

  const cells: MonthCell[] = []
  // Leading filler from the previous month.
  for (let i = lead - 1; i >= 0; i--) {
    const day = prevTotal - i
    const y = month0 === 0 ? year - 1 : year
    const m = (month0 + 11) % 12
    cells.push({ dateKey: dateKeyOf(y, m, day), day, inMonth: false })
  }
  // This month.
  for (let day = 1; day <= total; day++) {
    cells.push({ dateKey: dateKeyOf(year, month0, day), day, inMonth: true })
  }
  // Trailing filler from the next month, out to a full 6×7 = 42 cells.
  let nextDay = 1
  while (cells.length < 42) {
    const y = month0 === 11 ? year + 1 : year
    const m = (month0 + 1) % 12
    cells.push({ dateKey: dateKeyOf(y, m, nextDay), day: nextDay, inMonth: false })
    nextDay++
  }

  const rows: MonthCell[][] = []
  for (let r = 0; r < 6; r++) rows.push(cells.slice(r * 7, r * 7 + 7))
  return rows
}

/**
 * Classify a calendar day: `past` (strictly before today), `available` (has open slots), or
 * `unavailable`. String compare is safe because all keys are zero-padded YYYY-MM-DD.
 */
export function dayState(dateKey: string, availableKeys: Set<string>, todayKey: string): DayState {
  if (dateKey < todayKey) return 'past'
  return availableKeys.has(dateKey) ? 'available' : 'unavailable'
}

/** Group availability slots by their server-provided local day (YYYY-MM-DD). Pure — no tz math. */
export function groupSlotsByDay<T extends { localDate: string }>(slots: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const s of slots) {
    const arr = m.get(s.localDate)
    if (arr) arr.push(s)
    else m.set(s.localDate, [s])
  }
  return m
}
