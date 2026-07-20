// src/lib/workshops/delivery.ts
// Pure, dependency-free decision logic for the Workshop/Seminar lead engine P3 (virtual
// delivery: Zoom attendance webhook, replay gating). Kept side-effect-free and import-free
// so it can be compiled standalone by tsc in the test harness AND reused by the API routes
// + server helpers. The routes gather the DB rows and do the crypto/network; these
// functions parse + decide. Mirrors the pattern in src/lib/workshops/attendance.ts.

// ── Zoom webhook event vocabulary ───────────────────────────────────────────────
// The endpoint URL-validation challenge Zoom sends on subscription (CRC). The route
// answers it with an HMAC of the plainToken (see src/lib/zoom/webhook.ts).
export const ZOOM_CRC_EVENT = 'endpoint.url_validation'

// Participant join/leave events. Zoom fires these for BOTH meetings and webinars; the
// engine treats them identically (correlate → derive attendance). They can fire multiple
// times per participant (reconnects), which is why deriveWebhookAttendance is idempotent.
export const ZOOM_PARTICIPANT_EVENTS = [
  'meeting.participant_joined',
  'meeting.participant_left',
  'webinar.participant_joined',
  'webinar.participant_left',
] as const

export type ParticipantAction = 'joined' | 'left' | 'other'

export interface ParsedParticipantEvent {
  action: ParticipantAction
  /** Zoom meeting/webinar id from payload.object.id — used to resolve the session. */
  meetingId: string | null
  /** The registrant token issued at provisioning (payload...participant.registrant_id). */
  registrantId: string | null
  /** Fallback correlation only (never name matching — §5). */
  email: string | null
  joinTime: string | null
  leaveTime: string | null
}

/**
 * Parse a verified Zoom webhook body into a normalized participant event. Accepts the
 * documented shape { event, payload: { object: { id, participant: {...} } } } for both
 * meeting.* and webinar.* events. Returns action='other' for anything that is not a
 * participant join/leave (the route ignores those). NEVER reads a display name for
 * correlation — only registrant_id / email.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseZoomParticipantEvent(evt: any): ParsedParticipantEvent {
  const type = String(evt?.event ?? '')
  const action: ParticipantAction = type.endsWith('participant_joined')
    ? 'joined'
    : type.endsWith('participant_left')
      ? 'left'
      : 'other'

  const object = evt?.payload?.object ?? {}
  const participant = object?.participant ?? {}

  const meetingId =
    object?.id != null ? String(object.id) : object?.uuid != null ? String(object.uuid) : null

  // Zoom sends the registrant token as `registrant_id` when the participant registered.
  const registrantId =
    participant?.registrant_id != null && String(participant.registrant_id).length > 0
      ? String(participant.registrant_id)
      : null

  const email =
    typeof participant?.email === 'string' && participant.email.includes('@')
      ? participant.email.toLowerCase()
      : null

  return {
    action,
    meetingId,
    registrantId,
    email,
    joinTime: participant?.join_time ? String(participant.join_time) : null,
    leaveTime: participant?.leave_time ? String(participant.leave_time) : null,
  }
}

// ── Attendance derivation (idempotent, manual-precedence-aware) ──────────────────

export type AttendanceStatus = 'registered' | 'attended' | 'no_show' | 'left_early'
export type CaptureMethod = 'checkin' | 'webhook' | 'manual'

export interface ExistingAttendance {
  status: AttendanceStatus | string
  capture_method?: CaptureMethod | string | null
  join_time?: string | null
  leave_time?: string | null
  duration_min?: number | null
}

export interface WebhookAttendanceWrite {
  status: AttendanceStatus
  capture_method: 'webhook'
  join_time: string | null
  leave_time: string | null
  duration_min: number | null
}

export type WebhookAttendanceDecision =
  | { action: 'skip'; reason: 'manual_precedence' | 'no_change' }
  | { action: 'write'; row: WebhookAttendanceWrite }

/** Earliest of two ISO timestamps (nulls ignored). */
function earliest(a: string | null | undefined, b: string | null | undefined): string | null {
  const av = a ? Date.parse(a) : NaN
  const bv = b ? Date.parse(b) : NaN
  if (Number.isNaN(av)) return b ?? null
  if (Number.isNaN(bv)) return a ?? null
  return av <= bv ? (a as string) : (b as string)
}

/** Latest of two ISO timestamps (nulls ignored). */
function latest(a: string | null | undefined, b: string | null | undefined): string | null {
  const av = a ? Date.parse(a) : NaN
  const bv = b ? Date.parse(b) : NaN
  if (Number.isNaN(av)) return b ?? null
  if (Number.isNaN(bv)) return a ?? null
  return av >= bv ? (a as string) : (b as string)
}

function durationMinutes(join: string | null, leave: string | null): number | null {
  if (!join || !leave) return null
  const j = Date.parse(join)
  const l = Date.parse(leave)
  if (Number.isNaN(j) || Number.isNaN(l) || l < j) return null
  return Math.round((l - j) / 60000)
}

/**
 * Decide the attendance write for a Zoom participant event, collapsing duplicate/reconnect
 * events into ONE correct row per (registration, session). Rules:
 *
 *   1. MANUAL PRECEDENCE (§ guardrail): a staff manual mark (capture_method='manual') is a
 *      deliberate correction and is NEVER clobbered by a later automated webhook event.
 *      Returns { action:'skip', reason:'manual_precedence' }.
 *   2. IDEMPOTENT MERGE: the effective attendance spans the EARLIEST join and the LATEST
 *      leave seen across all events (so reconnects and duplicate deliveries converge to the
 *      same result regardless of order/repeats).
 *   3. left_early is derived when a leave time is known AND the joined span is shorter than
 *      thresholdMin (a config default — assumption-badged). A join with no leave yet counts
 *      as 'attended' (they showed up).
 *   4. If the merge produces no change to the existing webhook row, returns
 *      { action:'skip', reason:'no_change' } so the route avoids audit churn.
 *
 * `thresholdMin` is workshop_comms_config.left_early_threshold_minutes.
 */
export function deriveWebhookAttendance(
  existing: ExistingAttendance | null,
  incoming: { joinTime: string | null; leaveTime: string | null },
  thresholdMin: number,
): WebhookAttendanceDecision {
  if (existing && existing.capture_method === 'manual') {
    return { action: 'skip', reason: 'manual_precedence' }
  }

  const join = earliest(existing?.join_time ?? null, incoming.joinTime)
  const leave = latest(existing?.leave_time ?? null, incoming.leaveTime)
  const duration = durationMinutes(join, leave)

  let status: AttendanceStatus
  if (leave && duration != null && duration < Math.max(0, thresholdMin)) {
    status = 'left_early'
  } else {
    status = 'attended'
  }

  const row: WebhookAttendanceWrite = {
    status,
    capture_method: 'webhook',
    join_time: join,
    leave_time: leave,
    duration_min: duration,
  }

  // No-op when nothing actually changes (idempotent duplicate delivery).
  if (
    existing &&
    existing.status === row.status &&
    (existing.join_time ?? null) === row.join_time &&
    (existing.leave_time ?? null) === row.leave_time &&
    (existing.duration_min ?? null) === row.duration_min
  ) {
    return { action: 'skip', reason: 'no_change' }
  }

  return { action: 'write', row }
}

// ── Replay gating (recording-consent block + finite window + access) ─────────────

export interface ReplayInputs {
  /** The session's recording pointer + finite window. */
  recordingUrl: string | null
  recordingExpiresAt: string | null // ISO
  /** The recording-consent disclosure config, if the workshop references an APPROVED one. */
  recordingDisclosureApproved: boolean
  /** Does the caller present a valid registration token for THIS workshop? */
  hasValidRegistration: boolean
  /** Current time (ISO) — passed in so this stays pure/deterministic. */
  nowIso: string
}

export type ReplayGate =
  | 'not_approved' //  recording-consent copy not approved yet — CANNOT activate (precondition 4)
  | 'no_access' //     caller is not a registrant for this workshop
  | 'not_available' //  no recording captured yet
  | 'window_closed' //  recording_expires_at has passed
  | 'available' //      serve the recording

/**
 * Evaluate whether the replay recording may be served. The recording-consent block is the
 * FIRST gate: a replay surface can never activate publicly until an approved (non-
 * placeholder) recording-consent disclosure is referenced (retained-communication rule —
 * 17a-4/4511). Order: consent-approved → access → recording-exists → within-window.
 */
export function evaluateReplayAccess(inp: ReplayInputs): ReplayGate {
  if (!inp.recordingDisclosureApproved) return 'not_approved'
  if (!inp.hasValidRegistration) return 'no_access'
  if (!inp.recordingUrl) return 'not_available'
  if (inp.recordingExpiresAt) {
    const exp = Date.parse(inp.recordingExpiresAt)
    const now = Date.parse(inp.nowIso)
    if (!Number.isNaN(exp) && !Number.isNaN(now) && now > exp) return 'window_closed'
  }
  return 'available'
}

/** Compute a finite recording expiry from a base time + a window in days (config default). */
export function recordingExpiryFrom(baseIso: string, windowDays: number): string | null {
  const base = Date.parse(baseIso)
  if (Number.isNaN(base)) return null
  return new Date(base + Math.max(0, windowDays) * 86400000).toISOString()
}
