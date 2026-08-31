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
  | 'reminder_3d'
  | 'reminder_1d'
  | 'reminder_day_of'
  | 'reminder_1h'
  | 'reminder_starting'

export type NurtureKind =
  | 'nurture_attended'
  | 'nurture_left_early'
  | 'nurture_no_show'
  | 'nurture_registered_no_show'
  | 'nurture_followup'

/** Batch 4 lifecycle kinds: schedule/venue change notices, the agency-cancellation
 *  notice, and the registrant-cancel acknowledgment. All TRANSACTIONAL — they service
 *  the registration itself (see REMINDER_CLASS below). */
export type ChangeKind = 'change_reschedule' | 'change_venue' | 'event_cancelled' | 'cancel_ack'

export type MessageKind = ReminderKind | NurtureKind | ChangeKind
export type Channel = 'sms' | 'email'

// ── The reminder-class allowlist (SETTLED consent model, D-3) ──────────────────
// Registering IS consent for these kinds — and ONLY these. Everything else (all
// nurture/marketing) requires the registration row's marketing_opt_in. The closed enum
// is what keeps a marketing kind from ever routing through the registration basis
// (the POLICY_DEADLINE-leak class, kept closed).
//
// Batch 4 adds the lifecycle service notices: a reschedule/venue-change/cancellation
// notice and the cancel acknowledgment SERVICE the registration the person already
// holds — they are transactional facts about their own signup, not marketing. STOP/DNC
// suppression still applies to every SMS at dispatch (unchanged).
export const REMINDER_CLASS: ReadonlySet<string> = new Set([
  'confirmation',
  'reminder_7d',
  'reminder_3d',
  'reminder_1d',
  'reminder_day_of',
  'reminder_1h',
  'reminder_starting',
  'change_reschedule',
  'change_venue',
  'event_cancelled',
  'cancel_ack',
])
export function isReminderClass(kind: string): boolean {
  return REMINDER_CLASS.has(kind)
}

// ── Claim generation (WS-029 re-arm key) ────────────────────────────────────────
// The send-once claim is (registration, channel, kind, cadence_generation). A material
// reschedule bumps the SESSION's generation, which re-arms exactly the kinds below —
// the pre-event reminders (their moment moved) and the change notices (one per change).
// Everything else is once-EVER (generation 0): a reschedule must never replay a
// confirmation, a nurture message, or a cancel acknowledgment.
export const REARMABLE_KINDS: ReadonlySet<string> = new Set([
  'reminder_7d',
  'reminder_3d',
  'reminder_1d',
  'reminder_day_of',
  'reminder_1h',
  'reminder_starting',
  'change_reschedule',
  'change_venue',
  'event_cancelled',
])

/** The cadence_generation a claim for `kind` is keyed at. One-time kinds pin to 0. */
export function claimGeneration(kind: string, sessionGeneration: number | null | undefined): number {
  if (!REARMABLE_KINDS.has(kind)) return 0
  const g = typeof sessionGeneration === 'number' && Number.isFinite(sessionGeneration) ? sessionGeneration : 1
  return Math.max(1, Math.trunc(g))
}

/**
 * Which change-notice kind a session edit produces. A time move (start/end/timezone)
 * dominates — its notice template restates the full details, venue included — so a
 * combined move+venue edit sends ONE reschedule notice, never two.
 */
export function pickChangeKind(input: { timeChanged: boolean; venueChanged: boolean }): 'change_reschedule' | 'change_venue' | null {
  if (input.timeChanged) return 'change_reschedule'
  if (input.venueChanged) return 'change_venue'
  return null
}

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
 *
 * D-1(b) cadence: 7d · 3d · 1d (offsets) + day-of-AM (WALL-CLOCK, not an offset — see
 * isDayOfDue) + starting (offset 0, virtual/hybrid only — WS-071). The 60-minute mapping
 * is retained as CAPABILITY for an explicitly configured 1h touch; it is no longer in
 * the default offset set.
 */
export function reminderKindForOffset(offsetMinutes: number): ReminderKind | null {
  switch (offsetMinutes) {
    case 10080:
      return 'reminder_7d'
    case 4320:
      return 'reminder_3d'
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

/** Config offsets that map to NO cadence kind — the engine logs these once per pass
 *  (a stray value is a visible config defect, never a silent drop). */
export function unmappedOffsets(offsetsMinutes: number[]): number[] {
  return offsetsMinutes.filter((o) => reminderKindForOffset(o) === null)
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

// ── Day-of-AM (WALL-CLOCK kind — D-1(b)) ────────────────────────────────────────

/**
 * The zone if it is one this runtime can actually resolve, else null. Import-free (this
 * module compiles standalone), so it re-implements the `new Intl.DateTimeFormat` probe
 * that src/lib/booking/config-schemas.ts:isValidIanaZone uses rather than importing it.
 * A blank string is not a zone: the workshop_sessions.timezone column is NOT NULL with a
 * default, so '' — not null — is the shape an unset zone actually arrives in.
 */
export function usableZone(timeZone: string | null | undefined): string | null {
  if (typeof timeZone !== 'string') return null
  const tz = timeZone.trim()
  if (!tz) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

/** Hour (venue-local) the day-of reminder fires. Operating setting, not a legal rule. */
export const DAY_OF_LOCAL_HOUR = 9

/**
 * The UTC instant of 9:00 AM on the session's VENUE-local calendar date. Derived from
 * the venue zone EACH TICK (never precomputed), so it is DST-correct: the offset at the
 * session start governs — US transitions happen at 2:00 AM local, so 9:00 AM and any
 * later same-day start always share the offset.
 */
export function dayOfNineAmMs(startMs: number, venueZone: string | null | undefined): number | null {
  // FAIL CLOSED. This one is not display: it decides WHEN a reminder fires. Substituting
  // Central for an unresolved venue zone sends the day-of message at the wrong hour of
  // someone's morning, and does it silently. No usable zone → no fire time, and
  // isDayOfDue below returns false, so the day-of reminder is simply not due.
  const zone = usableZone(venueZone)
  if (!zone) return null
  let y: number, m: number, d: number
  try {
    // en-CA renders YYYY-MM-DD.
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(startMs))
      .split('-')
      .map(Number)
    ;[y, m, d] = parts
  } catch {
    const dt = new Date(startMs)
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate()
  }
  const offsetHours = utcOffsetHoursForTimezone(zone, startMs)
  if (offsetHours === null) return null
  return Date.UTC(y, m - 1, d, DAY_OF_LOCAL_HOUR, 0, 0) - offsetHours * 60 * MIN
}

/**
 * Is the day-of-AM reminder due? Fires in [9:00 AM venue-local on the event's venue
 * calendar date, session start]. A registrant who signed up after that 9:00 AM already
 * holds a same-day confirmation — skip (same rule as the offset reminders). A session
 * that STARTS before 9:00 AM local never gets one (the window is empty).
 */
export function isDayOfDue(input: { startMs: number; nowMs: number; registeredMs: number; venueZone: string | null | undefined }): boolean {
  const fireAt = dayOfNineAmMs(input.startMs, input.venueZone)
  if (fireAt === null) return false
  if (fireAt >= input.startMs) return false
  return input.registeredMs <= fireAt && input.nowMs >= fireAt && input.nowMs <= input.startMs
}

/**
 * The full set of reminder kinds due for one registration on this tick, given the config
 * offsets, the venue zone (day-of-AM wall-clock) and the session delivery mode
 * (`reminder_starting` is VIRTUAL/HYBRID only — WS-071: an in-person attendee walking in
 * has no join link to tap). The engine 'confirmation' kind is GONE (D-8): the instant
 * transactional ack at registration is the single confirmation of record.
 * Order is stable (offsets as configured, then day-of). Unknown offsets are dropped
 * (surface them with unmappedOffsets()).
 */
export function dueReminderKinds(input: {
  startMs: number
  nowMs: number
  registeredMs: number
  offsetsMinutes: number[]
  venueZone: string | null | undefined
  deliveryMode: string | null | undefined
}): ReminderKind[] {
  const out: ReminderKind[] = []
  for (const offset of input.offsetsMinutes) {
    const kind = reminderKindForOffset(offset)
    if (!kind) continue
    if (kind === 'reminder_starting' && input.deliveryMode !== 'virtual' && input.deliveryMode !== 'hybrid') continue
    if (isReminderDue({ offsetMinutes: offset, startMs: input.startMs, nowMs: input.nowMs, registeredMs: input.registeredMs })) {
      if (!out.includes(kind)) out.push(kind)
    }
  }
  if (isDayOfDue({ startMs: input.startMs, nowMs: input.nowMs, registeredMs: input.registeredMs, venueZone: input.venueZone })) {
    if (!out.includes('reminder_day_of')) out.push('reminder_day_of')
  }
  return out
}

// ── Quiet-hours scheduling pre-check (recipient-local) ──────────────────────────

/** Within the 9am–8pm recipient-local quiet-hours floor (mirrors the gate). */
export function withinQuietHours(localHour: number): boolean {
  return localHour >= QUIET_START_HOUR && localHour < QUIET_END_HOUR
}

/**
 * Resolve an IANA timezone to a whole-hour UTC offset at a given instant, using Intl (no
 * project imports). Returns NULL for an absent or unknown zone.
 *
 * It used to return a "conservative Central floor" of −6 instead. That is a guess wearing
 * the word conservative: −6 is only conservative for a venue that happens to be Central,
 * and for anywhere else it moves the computed local hour by up to six. Its sole caller is
 * dayOfNineAmMs, which now fails closed on null rather than scheduling from a default.
 */
export function utcOffsetHoursForTimezone(timeZone: string | null | undefined, atMs: number): number | null {
  const zone = usableZone(timeZone)
  if (!zone) return null
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
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
    return null
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

// Self-clearing gate steps — a retry on a later tick can genuinely succeed once time
// passes or a staged hold lifts. Mirrors gate.ts DEFERRAL_GATE_STEPS (+ quiet_hours,
// which for a reminder is likewise just "wrong time of day"); duplicated as a constant
// ONLY so this module stays import-free (the same pattern as the quiet-hours constants
// above) — gate.ts remains the authority on what blocks vs defers a send.
//
// MERGE NOTE: main and this branch arrived at this set independently. Main's is the
// superset — it adds `configured_window`, the step its configurable quiet-hours window
// introduced — so main's list is kept verbatim. WS-026's reason for `sms_live` (A2P
// staging was previously TERMINAL, burning every slot until approval) is unchanged by it.
const RETRYABLE_GATE_STEPS: ReadonlySet<string> = new Set([
  'quiet_hours',
  'business_hours',
  'configured_window',
  'frequency',
  'collision',
  'sms_live',
])

/** Bounded retries for a PROVIDER failure (sent=false with no gate block): transient
 *  Twilio/Resend errors retry a few ticks, then park terminally for a human. Branch-only
 *  (WS-026); main has no equivalent, so it is carried forward. */
export const PROVIDER_RETRY_MAX = 4

/**
 * Map a dispatch outcome to the terminal (or retryable) send-log status.
 *   • sent                                       → 'sent' (terminal)
 *   • blocked on a self-clearing step (time
 *     windows, frequency/collision, SMS staging)  → 'deferred' (retry next tick)
 *   • not sent with NO gate block (provider failure) → 'deferred' while attempts <
 *     PROVIDER_RETRY_MAX, else 'blocked' (bounded — WS-026)
 *   • blocked on any other step                   → 'blocked' (terminal — consent/DNC/
 *     suppression/recommendation/securities/template do not fix themselves on retry)
 */
export function classifySendOutcome(sent: boolean, blockedStep: string | null | undefined, attempts = 1): LogStatus {
  if (sent) return 'sent'
  if (blockedStep != null && RETRYABLE_GATE_STEPS.has(blockedStep)) return 'deferred'
  if (blockedStep == null) return attempts < PROVIDER_RETRY_MAX ? 'deferred' : 'blocked'
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

/** The T+2/3d follow-up (D-1 pairing): due once now ≥ (anchor + followupDelay). Same
 *  shape as isNurtureDue; kept distinct so the two delays can never be conflated. */
export function isFollowupDue(input: { anchorMs: number; nowMs: number; followupDelayMinutes: number }): boolean {
  return input.nowMs >= input.anchorMs + input.followupDelayMinutes * MIN
}

// ── Plaintext part (WS-067) ─────────────────────────────────────────────────────

/**
 * Derive the multipart text/plain part from a workshop email's HTML body. Deliberately
 * simple (block tags → line breaks, tags stripped, entities decoded, links kept as
 * "text (url)") — the goal is an honest, readable alternative part, not a renderer.
 */
export function toPlainText(html: string): string {
  return html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim()
      return label && href && label !== href ? `${label} (${href})` : label || href
    })
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<(hr)\b[^>]*>/gi, '\n----------\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
