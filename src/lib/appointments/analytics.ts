// src/lib/appointments/analytics.ts
// PURE, DB-free aggregations for the booking analytics / observability surface (P4). Everything is
// DERIVED from existing rows — appointments, comm_messages (entity=appointment), and
// comm_message_events — so there is NO new events table and NO migration. The server component reads
// the rows and passes them here; these functions are unit-provable in isolation. Reuses the
// lifecycle funnel (recovery.ts) so the analytics show-rate can never diverge from the command
// center's.

import { type Appointment } from './recovery'

export interface AnalyticsAppointment extends Appointment {
  starts_at: string | null
  booked_via: string | null
  meeting_mode: string | null
  reminder_sent_at: string | null
}

export interface Breakdown {
  key: string
  label: string
  count: number
  /** Integer percent of the non-empty total. */
  pct: number
}

function tally(rows: string[], labels: Record<string, string>, order: string[]): Breakdown[] {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r, (counts.get(r) ?? 0) + 1)
  const total = rows.length
  const keys = [...order, ...[...counts.keys()].filter((k) => !order.includes(k))]
  const seen = new Set<string>()
  const out: Breakdown[] = []
  for (const k of keys) {
    if (seen.has(k)) continue
    seen.add(k)
    const count = counts.get(k) ?? 0
    if (count === 0 && !order.includes(k)) continue
    out.push({ key: k, label: labels[k] ?? k, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 })
  }
  return out
}

const BOOKED_VIA_LABELS: Record<string, string> = { native: 'Self-serve', manual: 'Manual / review', legacy_calendly: 'Legacy (Calendly)' }
const MEETING_MODE_LABELS: Record<string, string> = { video: 'Video', phone: 'Phone', in_person: 'In person', unset: 'Unspecified' }

/** How appointments were booked (self-serve vs manual vs migrated). */
export function bookedViaBreakdown(appts: AnalyticsAppointment[]): Breakdown[] {
  return tally(
    appts.map((a) => a.booked_via ?? 'manual'),
    BOOKED_VIA_LABELS,
    ['native', 'manual', 'legacy_calendly'],
  )
}

/** Meeting-format mix. */
export function meetingModeBreakdown(appts: AnalyticsAppointment[]): Breakdown[] {
  return tally(
    appts.map((a) => a.meeting_mode ?? 'unset'),
    MEETING_MODE_LABELS,
    ['video', 'phone', 'in_person', 'unset'],
  )
}

export interface ReminderCoverage {
  /** Past appointments that were scheduled/completed (i.e. eligible to have been reminded). */
  eligible: number
  /** Of those, how many recorded a reminder send. */
  reminded: number
  pct: number
}

/**
 * Reminder coverage: of past appointments that actually occurred (start ≤ now, not cancelled), how
 * many recorded a reminder send (`reminder_sent_at`). An honest operational health metric — a low
 * value means the reminder job or consent gate suppressed sends.
 */
export function reminderCoverage(appts: AnalyticsAppointment[], nowMs: number): ReminderCoverage {
  let eligible = 0
  let reminded = 0
  for (const a of appts) {
    if (a.status === 'cancelled') continue
    const iso = a.starts_at ?? a.scheduled_at
    const ms = iso ? Date.parse(iso) : NaN
    if (Number.isNaN(ms) || ms > nowMs) continue // only past appointments could have been reminded
    eligible += 1
    if (a.reminder_sent_at) reminded += 1
  }
  return { eligible, reminded, pct: eligible > 0 ? Math.round((reminded / eligible) * 100) : 0 }
}

export interface NotificationStats {
  total: number
  delivered: number
  failed: number
  blocked: number
  /** delivered ÷ (attempted = total − queued), integer percent. */
  deliveredPct: number
  /** distinct delivered messages with an open event ÷ delivered. */
  openPct: number
  /** distinct delivered messages with a click event ÷ delivered. */
  clickPct: number
}

/**
 * Delivery observability for appointment notifications, from comm_messages(entity=appointment) +
 * their comm_message_events. Open/click are deduped by message so multiple events don't inflate the
 * rate. Rates are 0 (not NaN) when there is nothing to divide by (§32: 0 ≠ no data).
 */
export function notificationStats(
  messages: { id: string; delivery_status: string }[],
  events: { message_id: string | null; event: string }[],
): NotificationStats {
  let queued = 0
  let delivered = 0
  let failed = 0
  let blocked = 0
  for (const m of messages) {
    if (m.delivery_status === 'queued') queued += 1
    else if (m.delivery_status === 'delivered') delivered += 1
    else if (m.delivery_status === 'failed') failed += 1
    else if (m.delivery_status === 'blocked') blocked += 1
  }
  const total = messages.length
  const attempted = total - queued
  const opened = new Set<string>()
  const clicked = new Set<string>()
  for (const e of events) {
    if (!e.message_id) continue
    if (e.event === 'opened') opened.add(e.message_id)
    else if (e.event === 'clicked') clicked.add(e.message_id)
  }
  return {
    total,
    delivered,
    failed,
    blocked,
    deliveredPct: attempted > 0 ? Math.round((delivered / attempted) * 100) : 0,
    openPct: delivered > 0 ? Math.round((opened.size / delivered) * 100) : 0,
    clickPct: delivered > 0 ? Math.round((clicked.size / delivered) * 100) : 0,
  }
}
