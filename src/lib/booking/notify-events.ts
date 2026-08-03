// src/lib/booking/notify-events.ts
// PURE lifecycle-event classifier for booking notifications (P5 Stage 2). DB-free and
// clock-injected so the event→template mapping, the multi-offset due rule, and the
// "relative when" copy are unit-provable offline. The impure send path (notify.ts) consumes
// this to pick the approved stored template per (event × channel) and to decide which
// reminder offsets fire on a given tick. Every template keyed here is transactional,
// green-zone, appointment-consent-basis copy (§4.2) — no product nudge, cross-sell, or
// referral ask (recap and no-show stay clean, ADR-027 / P5.4).

const MS_PER_MINUTE = 60_000

/** The six booking lifecycle events the delivery ledger records (mig 093 event CHECK). */
export type LifecycleEvent =
  | 'confirmation'
  | 'reminder'
  | 'rescheduled'
  | 'cancellation'
  | 'no_show_followup'
  | 'recap'

export type NotifyChannel = 'email' | 'sms'

export const LIFECYCLE_EVENTS: readonly LifecycleEvent[] = [
  'confirmation',
  'reminder',
  'rescheduled',
  'cancellation',
  'no_show_followup',
  'recap',
]

/**
 * Event → approved stored-template `source_key`, per channel. The EMAIL keys are the exact
 * keys the template registry (src/emails/registry.tsx) renders via `templates:build`, so a
 * classifier lookup always resolves to a real, reviewable draft (never an invented key). The
 * SMS keys are the Stage-4 targets — their templates are authored + A2P-reconciled before SMS
 * is enabled (`booking_reminder_config.sms_enabled` stays false until then).
 */
const EVENT_SOURCE_KEYS: Record<LifecycleEvent, Record<NotifyChannel, string>> = {
  confirmation: { email: 'appointment-confirmation', sms: 'appointment-confirmation-sms' },
  reminder: { email: 'appointment-reminder-email', sms: 'appointment-reminder-sms' },
  rescheduled: { email: 'appointment-rescheduled', sms: 'appointment-rescheduled-sms' },
  cancellation: { email: 'appointment-cancellation', sms: 'appointment-cancellation-sms' },
  no_show_followup: { email: 'appointment-noshow', sms: 'appointment-noshow-sms' },
  recap: { email: 'appointment-recap', sms: 'appointment-recap-sms' },
}

/** The approved-template source_key for one lifecycle event on one channel. */
export function sourceKeyFor(event: LifecycleEvent, channel: NotifyChannel): string {
  return EVENT_SOURCE_KEYS[event][channel]
}

/**
 * `offset_minutes` recorded in the delivery ledger for a non-reminder event. Immediate events
 * (confirmation/rescheduled/cancellation/no_show_followup/recap) carry 0; reminders carry their
 * lead offset and are handled by the multi-offset path, never this helper.
 */
export const IMMEDIATE_OFFSET = 0

/** True iff the event is a one-shot immediate notice (everything except the per-offset reminder). */
export function isImmediateEvent(event: LifecycleEvent): boolean {
  return event !== 'reminder'
}

/**
 * A soft, timezone-agnostic "when" phrase for reminder copy — e.g. "in about 24 hours",
 * "in about an hour", "in 7 days". Deliberately approximate: the EXACT wall time is carried
 * by the enforced {{appointment_time}} blocking token; this is only the friendly lead-in
 * ("your appointment is {{relative_when}}"), so it never asserts a precise instant. Returns ''
 * for a past/invalid start (the caller wouldn't remind on one).
 */
export function relativeWhen(startsAtIso: string, now: Date): string {
  const start = Date.parse(startsAtIso)
  if (!Number.isFinite(start)) return ''
  const diffMin = Math.round((start - now.getTime()) / MS_PER_MINUTE)
  if (diffMin <= 0) return ''
  if (diffMin <= 75) return 'in about an hour'
  const diffHours = diffMin / 60
  if (diffHours < 36) return `in about ${Math.round(diffHours)} hours`
  return `in ${Math.round(diffHours / 24)} days`
}

/** A row (subset) the multi-offset reminder sweep reasons over. */
export interface ReminderOffsetCandidate {
  status: string
  startsAt: string | null
  bookedAt: string | null
}

/**
 * The subset of configured reminder offsets (minutes-before-start) that are DUE now for one
 * appointment — the multi-offset generalization of notify-core's single `isReminderDue`. An
 * offset fires when `now ∈ [start − offset, start)` for a still-scheduled appointment, and is
 * suppressed when the booking itself was made at/after that offset's window opened (the
 * confirmation already covered it — no near-immediate "reminder"). Fire-once across ticks and
 * reschedules is enforced by the delivery ledger's UNIQUE key, not here; this only decides
 * eligibility. Returned ascending. Invalid/duplicate/non-positive offsets are ignored.
 */
export function dueReminderOffsets(
  c: ReminderOffsetCandidate,
  offsetsMinutes: readonly number[],
  now: Date,
): number[] {
  if (c.status !== 'scheduled' || !c.startsAt) return []
  const start = Date.parse(c.startsAt)
  const nowMs = now.getTime()
  if (!Number.isFinite(start) || start <= nowMs) return []
  const booked = c.bookedAt ? Date.parse(c.bookedAt) : NaN
  const due: number[] = []
  const seen = new Set<number>()
  for (const raw of offsetsMinutes) {
    const offset = Math.trunc(raw)
    if (!Number.isFinite(offset) || offset <= 0 || seen.has(offset)) continue
    seen.add(offset)
    const windowOpen = start - offset * MS_PER_MINUTE
    if (nowMs < windowOpen) continue // too early for this offset
    // Booking landed at/after this offset's window opened → confirmation suffices, skip it.
    if (Number.isFinite(booked) && booked >= windowOpen) continue
    due.push(offset)
  }
  return due.sort((a, b) => a - b)
}
