// src/lib/booking/notification-config.ts
// The ONE reader for `booking_reminder_config` (mig 093) — which pre-appointment reminder
// offsets fire, and on which channels.
//
// It lives on its own so the send path (notify.ts) and the FSA-facing settings page read the
// SAME row through the SAME degradation rules. The panel used to hardcode "SMS — not enabled"
// while the table's `sms_enabled` had already defaulted to true, so the screen told the FSA the
// opposite of what the system would actually do.
//
// Degrades, never throws: if the table or row is absent (a build deployed ahead of its
// migration) it falls back to the single legacy 24h email offset — the behavior that predates
// the table — rather than erroring a settings page or a cron tick.

import { getDb } from '@/lib/supabase/client'
import { DEFAULT_REMINDER_LEAD_HOURS } from './notify-core'

export interface ReminderConfig {
  /** Minutes-before-start, positive, de-duped, ascending-agnostic. */
  offsets: number[]
  emailEnabled: boolean
  smsEnabled: boolean
  /** The stored values are unverified config defaults (§4.3 gold badge). */
  isAssumption: boolean
  /** False when the row could not be read and the legacy fallback is in force. */
  resolved: boolean
}

/** Reminder lead (hours before start) from the environment. Configurable; defaults to 24h. */
export function reminderLeadHours(): number {
  const raw = Number.parseInt(process.env.BOOKING_REMINDER_LEAD_HOURS || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REMINDER_LEAD_HOURS
}

function fallbackConfig(): ReminderConfig {
  return { offsets: [reminderLeadHours() * 60], emailEnabled: true, smsEnabled: false, isAssumption: true, resolved: false }
}

/**
 * PURE normalization of a `booking_reminder_config` row. Split out so the offset-cleaning and
 * enabled-flag defaults are provable offline. Invalid, non-positive and duplicate offsets are
 * dropped; an empty result falls back to the configured lead. `sms_enabled` must be explicitly
 * true (fail-closed on a null/absent column).
 */
export function normalizeReminderConfig(
  row:
    | { offsets_minutes?: unknown; email_enabled?: unknown; sms_enabled?: unknown; is_assumption?: unknown }
    | null
    | undefined,
): ReminderConfig {
  const fallback = fallbackConfig()
  if (!row) return fallback
  const raw = Array.isArray(row.offsets_minutes) ? (row.offsets_minutes as number[]) : []
  const offsets = [...new Set(raw.map((n) => Math.trunc(n)).filter((n) => Number.isFinite(n) && n > 0))]
  return {
    offsets: offsets.length ? offsets : fallback.offsets,
    emailEnabled: row.email_enabled !== false,
    smsEnabled: row.sms_enabled === true,
    isAssumption: row.is_assumption !== false,
    resolved: true,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = ReturnType<typeof getDb>

/** Read + normalize the global reminder configuration on a caller-supplied client. */
export async function loadReminderConfig(db: Db): Promise<ReminderConfig> {
  try {
    const { data, error } = await db
      .from('booking_reminder_config')
      .select('offsets_minutes, email_enabled, sms_enabled, is_assumption')
      .eq('id', 'global')
      .maybeSingle()
    if (error || !data) return fallbackConfig()
    return normalizeReminderConfig(data)
  } catch {
    return fallbackConfig()
  }
}

/** Read the global reminder configuration (server components / routes with no client at hand). */
export async function loadBookingNotificationConfig(): Promise<ReminderConfig> {
  try {
    return await loadReminderConfig(getDb())
  } catch {
    return fallbackConfig()
  }
}
