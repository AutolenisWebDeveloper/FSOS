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

/** How far ahead of a quiet-hours boundary an earlier-shifted reminder targets (≥ two 15-min ticks). */
const EARLY_SHIFT_MARGIN_MS = 30 * MS_PER_MINUTE
/** Scan granularity for the nearest allowed instant — the reminder cron runs every 15 minutes. */
const SCAN_STEP_MS = 15 * MS_PER_MINUTE

/**
 * PURE. Owner decisions 2 + 3 (docs/ops/automation-inventory.md §10): a reminder SMS respects the
 * 09:00–20:00 floor, and it does not HOLD — one whose configured time (`windowOpenMs`, i.e.
 * start − offset) lands in quiet hours moves to the NEAREST allowed time before the appointment,
 * or is skipped when there is none.
 *
 *   • configured time allowed → due from then (unchanged behaviour);
 *   • otherwise the nearer of: the end of the previous allowed span (minus a 30-minute margin so a
 *     15-minute tick lands inside it, and never before the booking/reschedule anchor), or the start
 *     of the next allowed span (only if it is before the appointment);
 *   • neither → 'skip'.
 * At any instant the send also needs `allowedAt(now)`, so a tick that falls outside the floor after
 * the target waits for the next allowed tick rather than sending at night, and skips once no
 * allowed instant remains before the start. `allowedAt` is supplied by the caller (recipient zone,
 * or every continental zone when unresolved — owner decision 1).
 */
export function reminderSmsTiming(
  c: { windowOpenMs: number; startMs: number; anchorMs: number | null; nowMs: number },
  allowedAt: (ms: number) => boolean,
): 'due' | 'not_yet' | 'skip' {
  if (!(c.nowMs < c.startMs)) return 'skip'
  return timingAt(reminderSmsTarget(c, allowedAt), c, allowedAt)
}

/**
 * PURE. Where a reminder SMS is aimed (ms), or null when it is skipped:
 *   • its configured time, when inside the floor;
 *   • otherwise the nearer of the end of the previous allowed span (minus the tick margin, never
 *     before the booking/reschedule anchor) and the start of the next one before the appointment;
 *   • follow-up R6: a reminder that would move EARLIER by more than half its offset is skipped
 *     (a 1-hour reminder never becomes a text the evening before).
 */
export function reminderSmsTarget(
  c: { windowOpenMs: number; startMs: number; anchorMs: number | null },
  allowedAt: (ms: number) => boolean,
): number | null {
  const { windowOpenMs, startMs, anchorMs } = c
  if (allowedAt(windowOpenMs)) return windowOpenMs
  const maxEarlierMs = (startMs - windowOpenMs) / 2
  let prev: number | null = null
  for (let t = windowOpenMs - SCAN_STEP_MS; t > windowOpenMs - 24 * 60 * MS_PER_MINUTE; t -= SCAN_STEP_MS) {
    if (allowedAt(t)) { prev = t - EARLY_SHIFT_MARGIN_MS; break }
  }
  if (prev !== null && (!allowedAt(prev) || (anchorMs !== null && prev <= anchorMs))) prev = null
  if (prev !== null && windowOpenMs - prev > maxEarlierMs) prev = null
  let next: number | null = null
  for (let t = windowOpenMs + SCAN_STEP_MS; t < startMs; t += SCAN_STEP_MS) {
    if (allowedAt(t)) { next = t; break }
  }
  if (prev !== null && next !== null) return windowOpenMs - prev <= next - windowOpenMs ? prev : next
  return prev ?? next
}

function timingAt(
  target: number | null,
  c: { startMs: number; nowMs: number },
  allowedAt: (ms: number) => boolean,
): 'due' | 'not_yet' | 'skip' {
  if (target === null) return 'skip'
  if (c.nowMs < target) return 'not_yet'
  if (allowedAt(c.nowMs)) return 'due'
  // Past the target but outside the floor: wait for the next allowed tick, if one remains.
  for (let t = c.nowMs + SCAN_STEP_MS; t < c.startMs; t += SCAN_STEP_MS) if (allowedAt(t)) return 'not_yet'
  return 'skip'
}

/** Follow-up R6: the least time between two reminder SMS for one appointment. */
export const MIN_REMINDER_SPACING_MS = 2 * 60 * MS_PER_MINUTE

/**
 * PURE. Plans every SMS reminder offset for one appointment and says which are due now.
 *   • an offset whose window opened at/before the booking/reschedule anchor is covered by that
 *     notice and is not planned (unchanged);
 *   • each offset is aimed by reminderSmsTarget (floor, nearest allowed time, half-offset limit);
 *   • follow-up R6: two reminders are never planned within 2 hours of each other — offsets are
 *     placed closest-to-the-appointment first, and a later-placed one that would land within
 *     2 hours of a kept one is skipped. Targets are deterministic, so every tick agrees.
 * Returns the offsets due now, and how many offsets are past their window with no send left.
 */
export function planSmsReminders(
  c: { offsetsMinutes: readonly number[]; startMs: number; anchorMs: number | null; nowMs: number },
  allowedAt: (ms: number) => boolean,
): { due: number[]; skipped: number } {
  const { startMs, anchorMs, nowMs } = c
  if (!Number.isFinite(startMs)) return { due: [], skipped: 0 }
  const offsets = [...new Set(c.offsetsMinutes.map((o) => Math.trunc(o)))].filter((o) => Number.isFinite(o) && o > 0).sort((a, b) => a - b)
  const kept: number[] = []
  const due: number[] = []
  let skipped = 0
  for (const offset of offsets) {
    const windowOpenMs = startMs - offset * MS_PER_MINUTE
    if (anchorMs !== null && anchorMs >= windowOpenMs) continue
    let target = reminderSmsTarget({ windowOpenMs, startMs, anchorMs }, allowedAt)
    if (target !== null && kept.some((k) => Math.abs(k - target!) < MIN_REMINDER_SPACING_MS)) target = null
    if (target !== null) kept.push(target)
    const verdict = nowMs < startMs ? timingAt(target, { startMs, nowMs }, allowedAt) : 'skip'
    if (verdict === 'due') due.push(offset)
    else if (verdict === 'skip' && nowMs >= windowOpenMs) skipped++
  }
  return { due, skipped }
}
