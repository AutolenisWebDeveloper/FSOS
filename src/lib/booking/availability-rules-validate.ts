// src/lib/booking/availability-rules-validate.ts
// PURE, server-authoritative validation of the availability RULE SET (the cross-rule checks Zod's
// per-rule schema can't do), plus the "which future appointments fall outside the new template"
// computation. Both read rules through the SAME engine primitives (isInstantWithinTemplate reuses
// wallParts/parseHHMM/weekday), so neither can drift from computeAvailableSlots. The client may
// reuse validateAvailabilityRules for instant UX, but the server is the enforcing authority.
//
// Overlap policy is MATCHED to the engine's real contract (verified, not guessed): computeAvailable
// Slots emits each active window's slot grid and DEDUPES candidates by exact UTC start — overlapping
// same-day windows are a valid, unioned config, NOT an error. So overlaps are surfaced as a
// non-blocking advisory (they usually indicate a mistake), never rejected.

import { isInstantWithinTemplate, type AvailabilityRule } from './availability'
import { parseHHMM } from './timezone'

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export interface OverlapWarning {
  weekday: number
  label: string
  timezone: string
  first: { start: string; end: string }
  second: { start: string; end: string }
}

export interface RuleSetValidation {
  /** Non-blocking: same-weekday windows that overlap (the engine unions them). */
  overlaps: OverlapWarning[]
}

/**
 * Validate a rule SET. Non-blocking overlap advisory only — per-rule well-formedness (end>start,
 * in-range HH:MM, valid IANA zone, weekday 0–6) is enforced at the edge by the Zod schema
 * (config-schemas.ts) and is NOT re-relaxed here. Overlaps are compared within the same weekday AND
 * the same timezone (comparing wall times across zones is meaningless; single-practice = one zone;
 * cross-zone pairs are skipped, and the engine's UTC dedupe covers them regardless).
 */
export function validateAvailabilityRules(rules: AvailabilityRule[]): RuleSetValidation {
  const active = rules.filter((r) => r.active !== false)
  const overlaps: OverlapWarning[] = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      if (a.weekday !== b.weekday || a.timezone !== b.timezone) continue
      const aS = parseHHMM(a.startTime)
      const aE = parseHHMM(a.endTime)
      const bS = parseHHMM(b.startTime)
      const bE = parseHHMM(b.endTime)
      if (aS < bE && bS < aE) {
        overlaps.push({
          weekday: a.weekday,
          label: WEEKDAY_LABELS[a.weekday] ?? `Day ${a.weekday}`,
          timezone: a.timezone,
          first: { start: a.startTime, end: a.endTime },
          second: { start: b.startTime, end: b.endTime },
        })
      }
    }
  }
  return { overlaps }
}

/**
 * Of the given (future, scheduled) appointments, those whose start does NOT fall inside the new
 * template. Reuses isInstantWithinTemplate (the shared engine interpretation). Rows without a
 * parseable start are skipped (legacy / manual entries we can't place) rather than falsely flagged.
 */
export function appointmentsOutsideTemplate<T extends { starts_at: string | null }>(
  appointments: T[],
  rules: AvailabilityRule[],
): T[] {
  const out: T[] = []
  for (const a of appointments) {
    if (!a.starts_at) continue
    const ms = Date.parse(a.starts_at)
    if (Number.isNaN(ms)) continue
    if (!isInstantWithinTemplate(ms, rules)) out.push(a)
  }
  return out
}
