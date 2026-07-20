// src/lib/workshops/reminders.ts
// Pure, dependency-free decision logic for the Workshop/Seminar P2 comms engine
// (reminders + segmented post-event nurture). Kept side-effect-free and import-free so it
// compiles standalone with `tsc` in the test harness (tests/workshop-comms.test.mjs) AND is
// reused by the impure engine (comms-engine.ts). Mirrors the pattern of logic.ts /
// attendance.ts. The engine does the DB I/O + the actual sends (always through the existing
// dispatcher/gate); these functions only DECIDE.
//
// GUARDRAILS reflected here (enforcement lives in the engine + the gate):
//  - Quiet-hours: this module exposes the same 9am–8pm recipient-local floor the gate uses,
//    as a SCHEDULING pre-check (defer, don't escalate). The dispatcher gate remains the
//    authoritative enforcer at send time.
//  - is_security: excluded upstream in the engine's selection; not represented here.
//  - No invented data: offsets / deltas / windows are all read from workshop_comms_config
//    (assumption-badged). This module only maps between them and the cadence.

// ── Cadence kinds ───────────────────────────────────────────────────────────────

export type ReminderKind =
  | 'confirmation'
  | 'reminder_7d'
  | 'reminder_1d'
  | 'reminder_1h'
  | 'reminder_starting'

export type NurtureKind =
  | 'nurture_attended'
  | 'nurture_left_early'
  | 'nurture_no_show'
  | 'nurture_registered_no_show'

export type MessageKind = ReminderKind | NurtureKind
export type Channel = 'sms' | 'email'

// Quiet-hours floor — mirrors src/lib/compliance/guardrail.ts withinQuietHours (9–20
// recipient-local). Duplicated as a constant ONLY so this module stays import-free; the
// dispatcher gate is still the authority that blocks an out-of-hours send at dispatch.
export const QUIET_START_HOUR = 9
export const QUIET_END_HOUR = 20

const MIN = 60_000
// Grace window after start during which a "starting now" send is still due (a tick may not
// land exactly at T-0). Also caps how late a before-start reminder may fire (never after
// start). Config-default; not a Farmers fact.
const STARTING_GRACE_MS = 20 * MIN

// ── Offset → reminder-kind mapping (the known, editable offset set) ─────────────

/**
 * Map a config offset (minutes-before-start) to its reminder kind. Returns null for an
 * offset the cadence does not model, so a stray config value is skipped (and logged by the
 * engine) rather than firing an unlabelled send.
 */
export function reminderKindForOffset(offsetMinutes: number): ReminderKind | null {
  switch (offsetMinutes) {
    case 10080:
      return 'reminder_7d'
    case 1440:
      return 'reminder_1d'
    case 60:
      return 'reminder_1h'
    case 0:
      return 'reminder_starting'
    default:
      return null
  }
}

// ── Due-reminder decision ───────────────────────────────────────────────────────

export interface ReminderDueInput {
  offsetMinutes: number
  /** session start, epoch ms (UTC). */
  startMs: number
  /** now, epoch ms (UTC). */
  nowMs: number
  /** registration created_at, epoch ms (UTC). */
  registeredMs: number
}

/**
 * Is a before-start reminder due right now?
 *   fireAt = start − offset.
 *   • offset > 0: due when the registrant registered BEFORE fireAt (so we never fire a
 *     reminder whose moment already passed at registration — this is exactly spec §2.3
 *     "skip if booked <7d out"), AND now is in [fireAt, start].
 *   • offset = 0 ("starting now"): due when now is in [start, start + grace]; the
 *     registration-time check does not apply.
 * The engine still send-time-gates the result (quiet-hours, consent, DNC…).
 */
export function isReminderDue(input: ReminderDueInput): boolean {
  const { offsetMinutes, startMs, nowMs, registeredMs } = input
  const fireAt = startMs - offsetMinutes * MIN
  if (offsetMinutes <= 0) {
    return nowMs >= startMs && nowMs <= startMs + STARTING_GRACE_MS
  }
  return registeredMs <= fireAt && nowMs >= fireAt && nowMs <= startMs
}

/**
 * Is the immediate confirmation due? Confirmation fires as soon as the cron sees a fresh
 * registration, provided the event has not already started (nothing to confirm otherwise).
 */
export function isConfirmationDue(input: { startMs: number; nowMs: number }): boolean {
  return input.nowMs < input.startMs
}

/**
 * The full set of reminder kinds due for one registration on this tick, given the config
 * offsets. Confirmation is included first when enabled + due. Order is stable (confirmation,
 * then offsets as configured). Unknown offsets are dropped.
 */
export function dueReminderKinds(input: {
  startMs: number
  nowMs: number
  registeredMs: number
  offsetsMinutes: number[]
  confirmationEnabled: boolean
}): ReminderKind[] {
  const out: ReminderKind[] = []
  if (input.confirmationEnabled && isConfirmationDue({ startMs: input.startMs, nowMs: input.nowMs })) {
    out.push('confirmation')
  }
  for (const offset of input.offsetsMinutes) {
    const kind = reminderKindForOffset(offset)
    if (!kind) continue
    if (isReminderDue({ offsetMinutes: offset, startMs: input.startMs, nowMs: input.nowMs, registeredMs: input.registeredMs })) {
      if (!out.includes(kind)) out.push(kind)
    }
  }
  return out
}

// ── Quiet-hours scheduling pre-check (recipient-local) ──────────────────────────

/** Recipient-local hour (0–23) given now (ms) and the recipient tz offset in hours. */
export function recipientLocalHour(nowMs: number, utcOffsetHours: number): number {
  const utcHour = new Date(nowMs).getUTCHours()
  return (utcHour + utcOffsetHours + 24) % 24
}

/** Within the 9am–8pm recipient-local quiet-hours floor (mirrors the gate). */
export function withinQuietHours(localHour: number): boolean {
  return localHour >= QUIET_START_HOUR && localHour < QUIET_END_HOUR
}

/**
 * Resolve an IANA timezone to a whole-hour UTC offset at a given instant, using Intl (no
 * project imports). Falls back to the conservative Central floor (−6) when the zone is
 * unknown. Used to feed the recipient-local quiet-hours pre-check + the gate's
 * utcOffsetHours.
 */
export function utcOffsetHoursForTimezone(timeZone: string | null | undefined, atMs: number): number {
  const DEFAULT = -6
  if (!timeZone) return DEFAULT
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(new Date(atMs))
    const map: Record<string, number> = {}
    for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value)
    // Build a UTC timestamp from the wall-clock parts, then diff against the real instant.
    const asUtc = Date.UTC(map.year, (map.month ?? 1) - 1, map.day, map.hour === 24 ? 0 : map.hour, map.minute, map.second)
    const diffMs = asUtc - atMs
    return Math.round(diffMs / (60 * MIN))
  } catch {
    return DEFAULT
  }
}

// ── Idempotency / claim decision (overlapping cron ticks + retries = one send) ──

export type LogStatus = 'sending' | 'sent' | 'blocked' | 'deferred' | 'skipped'
export type ClaimDecision = 'claim' | 'retry' | 'skip'

/**
 * Decide what to do with a (registration, channel, kind) slot given its existing send-log
 * row (or null for none yet):
 *   • null            → 'claim'  (first time — insert a 'sending' row and dispatch)
 *   • 'deferred'      → 'retry'  (held for quiet/business hours — re-attempt this tick)
 *   • 'sending'       → 'skip'   (another overlapping tick owns it, or it is mid-flight)
 *   • 'sent'/'blocked'/'skipped' → 'skip' (terminal — NEVER resend)
 * This is the pure core of the idempotency guarantee; the engine turns 'claim'/'retry' into
 * an atomic DB claim (unique(reg,channel,kind)) so two ticks can never both win.
 */
export function decideClaim(existingStatus: LogStatus | null): ClaimDecision {
  if (existingStatus == null) return 'claim'
  if (existingStatus === 'deferred') return 'retry'
  return 'skip'
}

/**
 * Map a dispatch outcome to the terminal (or retryable) send-log status.
 *   • sent                                   → 'sent' (terminal)
 *   • blocked on a TIME step (quiet/business) → 'deferred' (retry next tick)
 *   • blocked on any other step               → 'blocked' (terminal — consent/DNC/
 *     recommendation/securities/template/other-rule do not fix themselves on retry)
 */
export function classifySendOutcome(sent: boolean, blockedStep: string | null | undefined): LogStatus {
  if (sent) return 'sent'
  if (blockedStep === 'quiet_hours' || blockedStep === 'business_hours') return 'deferred'
  return 'blocked'
}

// ── Post-event segmentation (off P1 attendance status) ──────────────────────────

export type AttendanceStatus = 'registered' | 'attended' | 'no_show' | 'left_early'
export type Segment = 'attended' | 'left_early' | 'no_show' | 'registered_no_show'

/**
 * Map an attendance status (or null = no attendance row) to a nurture segment.
 *   attended            → 'attended'            (thank-you + consult invite; +score)
 *   left_early          → 'left_early'          ("what you missed" + replay; +score)
 *   no_show             → 'no_show'             ("sorry we missed you" + re-engage; −score)
 *   null / 'registered' → 'registered_no_show'  (never checked in — recapture path)
 */
export function segmentFor(status: AttendanceStatus | null | undefined): Segment {
  if (status === 'attended') return 'attended'
  if (status === 'left_early') return 'left_early'
  if (status === 'no_show') return 'no_show'
  return 'registered_no_show'
}

/** The nurture template kind for a segment. */
export function nurtureKindForSegment(segment: Segment): NurtureKind {
  switch (segment) {
    case 'attended':
      return 'nurture_attended'
    case 'left_early':
      return 'nurture_left_early'
    case 'no_show':
      return 'nurture_no_show'
    case 'registered_no_show':
      return 'nurture_registered_no_show'
  }
}

/** The per-segment GHL tag the nurture pass adds (drives the manual GHL workflows). */
export function segmentTag(segment: Segment): string {
  switch (segment) {
    case 'attended':
    case 'left_early':
      return 'wshop-attended'
    case 'no_show':
      return 'wshop-noshow'
    case 'registered_no_show':
      return 'wshop-registered'
  }
}

export interface ScoreConfig {
  score_attended: number
  score_engaged: number
  score_no_show: number
  score_registered_no_show: number
  score_replay_viewed: number
}

/**
 * The lead-score delta a segment contributes (signed). left_early counts as attended
 * (they showed). "Engaged" (asked a question / requested consult) is a P3 feedback signal;
 * P2 uses the attended delta for the attended segment.
 */
export function scoreDeltaForSegment(segment: Segment, cfg: ScoreConfig): number {
  switch (segment) {
    case 'attended':
    case 'left_early':
      return cfg.score_attended
    case 'no_show':
      return cfg.score_no_show
    case 'registered_no_show':
      return cfg.score_registered_no_show
  }
}

/** Post-event nurture trigger: due once now ≥ (session end/start + delay). */
export function isNurtureDue(input: { anchorMs: number; nowMs: number; delayMinutes: number }): boolean {
  return input.nowMs >= input.anchorMs + input.delayMinutes * MIN
}

// ── CAN-SPAM commercial-email footer ────────────────────────────────────────────

/**
 * Build the CAN-SPAM footer appended to commercial workshop email (physical address +
 * one-click unsubscribe). Returns HTML. The unsubscribe link points at the existing public
 * /unsubscribe surface. Both pieces are REQUIRED on commercial email; the engine appends
 * this to every workshop nurture/reminder email body before dispatch.
 */
export function buildCanSpamFooter(input: { unsubscribeUrl: string; physicalAddress: string }): string {
  const addr = escapeHtml(input.physicalAddress)
  const url = input.unsubscribeUrl
  return (
    `\n<hr />\n<p style="font-size:12px;color:#667085;line-height:1.5">` +
    `You are receiving this because you registered for a workshop. ` +
    `<a href="${url}">Unsubscribe</a> at any time.<br />` +
    `${addr}` +
    `</p>`
  )
}

/** Append the footer to an email body once (idempotent on the unsubscribe marker). */
export function appendCanSpamFooter(body: string, footer: string): string {
  if (body.includes('/unsubscribe')) return body
  return `${body}${footer}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
