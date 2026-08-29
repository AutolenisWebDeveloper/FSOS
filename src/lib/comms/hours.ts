// src/lib/comms/hours.ts
// Hours of operation for automated outreach — the operator's control over WHEN the
// AI may contact people. Loads the singleton policy and evaluates the pure
// withinBusinessHours() decision (lib/compliance/guardrail.ts) in the BUSINESS
// timezone. This can only ever TIGHTEN sending: the send gate always also applies the
// legal quiet-hours floor (recipient-local 9–20), so a wider business window can
// never widen past the TCPA floor. Disabled/unset ⇒ no extra restriction.

import { getDb } from '../supabase/client'
import { withinBusinessHours, type BusinessHoursPolicy } from '../compliance/guardrail'

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

// ─────────────────────────────────────────────────────────────────────────────
// SCOPED send windows (Phase 2 / Batch 1c, step 4) — per-campaign and per-worker
// ─────────────────────────────────────────────────────────────────────────────
//
// `comm_hours_policy` becomes MULTI-ROW, following the pattern migration 104 established
// for `comm_conversation_policy`: `'global'` is the default row, and an additional row
// keyed `agent:<ai_agents.key>` or `campaign:<key>` overrides it for sends driven by that
// worker or campaign. Reusing this table rather than creating a parallel one keeps ONE
// hours-policy surface (CLAUDE.md §6) — its primary key was already `text`, so multi-row
// needed no type change.
//
// A window loaded here can only ever NARROW the statutory floor: quiet-hours-window.ts
// INTERSECTS it with the floor, so a wider configured window is arithmetically incapable
// of granting a send a time the floor forbids. That is a structural guarantee, not a
// validation rule someone could forget to apply.
//
// A DISABLED row is treated as ABSENT (returns null), matching migration 104's documented
// semantics for `comm_conversation_policy.enabled`.

import type { HoursWindow } from './quiet-hours-window'

/**
 * Load the configured send window for one scope key (`agent:cross_sell`,
 * `campaign:life_conversion`), or null when no row exists, the row is disabled, or the
 * lookup fails.
 *
 * Null means "this layer imposes no narrowing" — NOT "unrestricted". The statutory floor
 * is applied separately and always. Failing to a null here is therefore safe: it removes
 * an operator preference, never a legal control.
 */
export async function loadScopedHoursWindow(scopeKey: string): Promise<HoursWindow | null> {
  try {
    const { data } = await getDb()
      .from('comm_hours_policy')
      .select('enabled, start_hour, end_hour, days')
      .eq('id', scopeKey)
      .maybeSingle()
    if (!data || data.enabled === false) return null
    const startHour = Number(data.start_hour)
    const endHour = Number(data.end_hour)
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return null
    const days = Array.isArray(data.days) ? (data.days as number[]) : [0, 1, 2, 3, 4, 5, 6]
    return { startHour, endHour, days }
  } catch {
    return null
  }
}
