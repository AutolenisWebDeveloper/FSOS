// src/lib/booking/availability-summary.ts
// PURE, DB-free FSA-facing interpretation of the recurring weekly availability TEMPLATE. It reads
// the SAME engine `AvailabilityRule[]` the slot calculator consumes (map DB rows through
// availability.ts `ruleFromRow` first), so the summary can never drift from the rules clients
// actually book against. It is a TEMPLATE view only: it honors `active`, preserves multiple windows
// per weekday (never flattens them), and keeps each rule's timezone + effective range — it does NOT
// compute live bookable slots (that stays in computeAvailableSlots; blackouts / min-notice / buffers
// / one-off exceptions apply on top and are noted by the UI, not recomputed here).

import type { AvailabilityRule } from './availability'
// Reuse the ONE booking wall-clock formatter (the same one AvailabilityRulesManager renders rows
// with) — do not reintroduce a second time-interpretation.
import { formatWallTime } from './display'

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export interface AvailabilityWindow {
  /** Human start/end in the rule's wall-clock zone, e.g. "9:00 AM". */
  start: string
  end: string
  timezone: string
  effectiveStart: string | null
  effectiveEnd: string | null
}

export interface DayAvailability {
  weekday: number // 0=Sun … 6=Sat
  label: string
  windows: AvailabilityWindow[] // empty = unavailable that day
}

/**
 * Group active rules into a 7-day (Sun→Sat) recurring template. Inactive rules are excluded (same
 * `active !== false` semantics as the engine). Multiple windows on a weekday are preserved and
 * ordered by start time.
 */
export function describeWeeklyAvailability(rules: AvailabilityRule[]): DayAvailability[] {
  const active = rules
    .filter((r) => r.active !== false)
    .slice()
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))

  const byDay = new Map<number, AvailabilityWindow[]>()
  for (const r of active) {
    const arr = byDay.get(r.weekday) ?? []
    arr.push({
      start: formatWallTime(r.startTime),
      end: formatWallTime(r.endTime),
      timezone: r.timezone,
      effectiveStart: r.effectiveStart ?? null,
      effectiveEnd: r.effectiveEnd ?? null,
    })
    byDay.set(r.weekday, arr)
  }

  return WEEKDAY_LABELS.map((label, weekday) => ({ weekday, label, windows: byDay.get(weekday) ?? [] }))
}

/** The single timezone across the template, or null if none / mixed (single-practice = one zone). */
export function summaryTimezone(days: DayAvailability[]): string | null {
  const zones = new Set<string>()
  for (const d of days) for (const w of d.windows) zones.add(w.timezone)
  return zones.size === 1 ? [...zones][0] : null
}
