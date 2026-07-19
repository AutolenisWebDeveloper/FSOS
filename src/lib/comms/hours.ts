// src/lib/comms/hours.ts
// Hours of operation for automated outreach — the operator's control over WHEN the
// AI may contact people. Loads the singleton policy and evaluates the pure
// withinBusinessHours() decision (lib/compliance/guardrail.ts) in the BUSINESS
// timezone. This can only ever TIGHTEN sending: the send gate always also applies the
// legal quiet-hours floor (recipient-local 9–20), so a wider business window can
// never widen past the TCPA floor. Disabled/unset ⇒ no extra restriction.

import { getDb } from '@/lib/supabase/client'
import { withinBusinessHours, type BusinessHoursPolicy } from '@/lib/compliance/guardrail'

export interface HoursPolicy extends BusinessHoursPolicy {
  /** Business-timezone offset from UTC in hours (Central floor default -6). */
  timezoneOffsetHours: number
  isAssumption: boolean
}

/** Load the singleton hours-of-operation policy, or null if unconfigured. */
export async function loadHoursPolicy(): Promise<HoursPolicy | null> {
  try {
    const { data } = await getDb()
      .from('comm_hours_policy')
      .select('enabled, start_hour, end_hour, days, timezone_offset_hours, is_assumption')
      .eq('id', 'global')
      .maybeSingle()
    if (!data) return null
    return {
      enabled: data.enabled !== false,
      startHour: Number(data.start_hour ?? 9),
      endHour: Number(data.end_hour ?? 20),
      days: Array.isArray(data.days) ? (data.days as number[]) : [0, 1, 2, 3, 4, 5, 6],
      timezoneOffsetHours: Number(data.timezone_offset_hours ?? -6),
      isAssumption: data.is_assumption !== false,
    }
  } catch {
    return null
  }
}

/** Current hour (0–23) + day-of-week (0=Sun) in the business timezone. */
export function businessLocalNow(offsetHours: number): { hour: number; day: number } {
  const shifted = new Date(Date.now() + offsetHours * 3600000)
  return { hour: shifted.getUTCHours(), day: shifted.getUTCDay() }
}

/**
 * True if automated outreach is currently allowed by the operator's hours of
 * operation. A missing/disabled policy returns true (no extra restriction; the legal
 * floor still applies at the send gate). Used both as an orchestrator pre-check and,
 * per-send, to feed the gate's business_hours step.
 */
export async function isWithinOperatingHours(policy?: HoursPolicy | null): Promise<boolean> {
  const p = policy ?? (await loadHoursPolicy())
  if (!p || !p.enabled) return true
  const { hour, day } = businessLocalNow(p.timezoneOffsetHours)
  return withinBusinessHours(hour, day, p)
}
