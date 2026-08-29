// src/lib/workshops/server.ts
// Server-only helpers for the Workshop/Seminar lead engine (P0). These run with a
// service-role db client (getDb) passed in by the caller; they never instantiate a
// client (CLAUDE.md §1 convention 1). Pure decision logic lives in ./logic.ts.

import { randomUUID } from 'node:crypto'
import { deriveIsSecurity, decideSessionMeetingProvision } from './logic'
import { resolveCheckIn, type AttendanceStatus } from './attendance'
import { deriveWebhookAttendance, type ParsedParticipantEvent } from './delivery'
import { addZoomRegistrant, createZoomMeeting, deleteZoomMeeting, zoomEnabled } from '@/lib/zoom/client'
import {
  SIGNUP_FORM_VERSION,
  SMS_REMINDER_DISCLOSURE,
  MARKETING_OPT_IN_LABEL,
  EMAIL_REMINDER_BASIS,
} from './consent-copy'

// Minimal structural type for the Supabase client we use (avoids importing the SDK type).
type Db = ReturnType<typeof import('@/lib/supabase/client')['getDb']>

export const PLACEHOLDER_MARKER = '[PLACEHOLDER'

/**
 * Replace this workshop's presenter set with `presenterIds`, recompute the securities
 * firewall flag from the attached presenters, persist it, and snapshot each presenter's
 * bio + headshot as versioned workshop_materials rows for the approval record.
 * Returns the derived is_security value.
 */
export async function syncPresenters(
  db: Db,
  workshopId: string,
  presenterIds: string[],
): Promise<boolean> {
  // Replace join rows.
  await db.from('workshop_presenters').delete().eq('workshop_id', workshopId)
  if (presenterIds.length > 0) {
    await db.from('workshop_presenters').insert(
      presenterIds.map((presenter_id, i) => ({
        workshop_id: workshopId,
        presenter_id,
        display_order: i,
      })),
    )
  }

  // Load the attached presenters to derive the firewall flag + snapshot materials.
  const { data: presenters } = presenterIds.length
    ? await db
        .from('presenters')
        .select('id, name, bio, headshot_ref, is_third_party, fund_family, presenter_type')
        .in('id', presenterIds)
    : { data: [] as PresenterRow[] }

  const rows = (presenters ?? []) as PresenterRow[]
  const isSecurity = deriveIsSecurity(rows)
  await db.from('workshops').update({ is_security: isSecurity, updated_at: nowIso() }).eq('workshop_id', workshopId)

  // Snapshot presenter bio + headshot as materials (versioned) feeding the approval record.
  for (const p of rows) {
    if (p.bio) {
      await recordMaterial(db, {
        workshopId,
        kind: 'presenter_bio',
        label: p.name,
        contentSnapshot: p.bio,
      })
    }
    if (p.headshot_ref) {
      await recordMaterial(db, {
        workshopId,
        kind: 'presenter_headshot',
        label: p.name,
        storageRef: p.headshot_ref,
      })
    }
  }
  return isSecurity
}

interface PresenterRow {
  id: string
  name: string
  bio: string | null
  headshot_ref: string | null
  is_third_party: boolean | null
  fund_family: string | null
  presenter_type: string | null
}

/** Insert a versioned workshop_materials row (auto-increments version per (workshop, kind, label)). */
export async function recordMaterial(
  db: Db,
  args: {
    workshopId: string
    kind: string
    label?: string | null
    storageRef?: string | null
    contentSnapshot?: string | null
  },
): Promise<void> {
  const { count } = await db
    .from('workshop_materials')
    .select('*', { count: 'exact', head: true })
    .eq('workshop_id', args.workshopId)
    .eq('kind', args.kind)
  const version = (count ?? 0) + 1
  await db.from('workshop_materials').insert({
    workshop_id: args.workshopId,
    kind: args.kind,
    label: args.label ?? null,
    version,
    storage_ref: args.storageRef ?? null,
    content_snapshot: args.contentSnapshot ?? null,
    // finra_2210_class + filing_decision left NULL — compliance sets them (REQUIRES-APPROVAL).
  })
}

/**
 * Gather the two publish prerequisites for a workshop as booleans for the pure
 * evaluateWorkshopPublish() gate: an approved compliance approval + an approved
 * (non-placeholder) disclosure config.
 */
export async function gatherPublishFacts(
  db: Db,
  workshop: { compliance_approval_ref: string | null; disclosure_config_id: string | null },
): Promise<{ hasApprovedApproval: boolean; hasApprovedDisclosure: boolean }> {
  let hasApprovedApproval = false
  if (workshop.compliance_approval_ref) {
    const { data } = await db
      .from('workshop_approvals')
      .select('id, decision')
      .eq('id', workshop.compliance_approval_ref)
      .maybeSingle()
    hasApprovedApproval = data?.decision === 'approved'
  }
  let hasApprovedDisclosure = false
  if (workshop.disclosure_config_id) {
    const { data } = await db
      .from('workshop_disclosure_configs')
      .select('id, is_assumption, approved_by')
      .eq('id', workshop.disclosure_config_id)
      .maybeSingle()
    hasApprovedDisclosure = !!data && data.is_assumption === false && !!data.approved_by
  }
  return { hasApprovedApproval, hasApprovedDisclosure }
}

function nowIso(): string {
  return new Date().toISOString()
}

// ─── Attendance capture (P1) ────────────────────────────────────────────────────

interface RegForAttendance {
  reg_id: string
  workshop_id: string
  session_id: string | null
}

/**
 * Resolve the session a registration's attendance row is keyed to. Prefers the
 * registration's own session_id; falls back to the workshop's earliest session (the 1:1
 * default backfilled by migration 038) so attendance always has a valid session FK.
 */
async function resolveSessionId(db: Db, reg: RegForAttendance): Promise<string | null> {
  if (reg.session_id) return reg.session_id
  const { data } = await db
    .from('workshop_sessions')
    .select('id')
    .eq('workshop_id', reg.workshop_id)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

export type CheckInOutcome =
  | { ok: true; noop: boolean; registration_id: string; session_id: string }
  | { ok: false; error: string; status: number }

/**
 * Idempotent kiosk check-in by the registrant's unique join_token. A double-scan of an
 * already-checked-in registrant is a NO-OP (no write, no audit churn) — safe for spotty
 * venue wifi where the client may retry. Writes capture_method='checkin',
 * status='attended', checked_in_at on first scan.
 */
export async function checkInByToken(
  db: Db,
  workshopId: string,
  token: string,
): Promise<CheckInOutcome> {
  const { data: reg } = await db
    .from('workshop_registrations')
    .select('reg_id, workshop_id, session_id')
    .eq('join_token', token)
    .eq('workshop_id', workshopId)
    .maybeSingle()
  if (!reg) return { ok: false, error: 'No registration matches that code for this workshop.', status: 404 }

  const sessionId = await resolveSessionId(db, reg as RegForAttendance)
  if (!sessionId) return { ok: false, error: 'This workshop has no session to check into.', status: 409 }

  const { data: existing } = await db
    .from('workshop_attendance')
    .select('id, status, capture_method')
    .eq('registration_id', reg.reg_id)
    .eq('session_id', sessionId)
    .maybeSingle()

  const decided = resolveCheckIn(existing ? { status: existing.status as AttendanceStatus, capture_method: existing.capture_method } : null)
  if (!decided) {
    // Already attended — idempotent no-op.
    return { ok: true, noop: true, registration_id: reg.reg_id, session_id: sessionId }
  }

  await writeAttendance(db, {
    registrationId: reg.reg_id,
    sessionId,
    status: decided.status,
    captureMethod: decided.capture_method,
    checkedInAt: nowIso(),
    hasExisting: !!existing,
  })
  // Keep the legacy registration.attended flag in sync for back-compat readers.
  await db.from('workshop_registrations').update({ attended: true }).eq('reg_id', reg.reg_id)
  return { ok: true, noop: false, registration_id: reg.reg_id, session_id: sessionId }
}

/**
 * Upsert an attendance row for (registration_id, session_id) — the unique key in the P0
 * shell. Uses onConflict so a re-send updates in place rather than erroring (idempotent).
 */
async function writeAttendance(
  db: Db,
  args: {
    registrationId: string
    sessionId: string
    status: AttendanceStatus
    captureMethod: 'checkin' | 'manual' | 'webhook'
    checkedInAt?: string | null
    hasExisting?: boolean
  },
): Promise<void> {
  await db.from('workshop_attendance').upsert(
    {
      registration_id: args.registrationId,
      session_id: args.sessionId,
      status: args.status,
      capture_method: args.captureMethod,
      checked_in_at: args.checkedInAt ?? null,
    },
    { onConflict: 'registration_id,session_id' },
  )
}

export interface ReconcileEntry {
  registration_id: string
  status: AttendanceStatus
}

export interface ReconcileResult {
  written: number
  skipped: number
}

/**
 * Bulk/typed manual attendance reconcile (virtual + hybrid interim, or roster
 * corrections). Idempotent: an entry whose status already matches is skipped. Each write
 * is capture_method='manual'. Designed so a future Zoom webhook (P3) writes the SAME table
 * via writeAttendance with capture_method='webhook' — no rework. Returns counts for audit.
 */
export async function reconcileAttendance(
  db: Db,
  workshopId: string,
  entries: ReconcileEntry[],
): Promise<ReconcileResult> {
  // Load the registrations in one shot; ignore any that don't belong to this workshop.
  const ids = entries.map((e) => e.registration_id)
  const { data: regs } = await db
    .from('workshop_registrations')
    .select('reg_id, workshop_id, session_id')
    .in('reg_id', ids)
    .eq('workshop_id', workshopId)
  const regMap = new Map<string, RegForAttendance>()
  for (const r of (regs ?? []) as RegForAttendance[]) regMap.set(r.reg_id, r)

  let written = 0
  let skipped = 0
  for (const e of entries) {
    const reg = regMap.get(e.registration_id)
    if (!reg) {
      skipped++
      continue
    }
    const sessionId = await resolveSessionId(db, reg)
    if (!sessionId) {
      skipped++
      continue
    }
    const { data: existing } = await db
      .from('workshop_attendance')
      .select('id, status')
      .eq('registration_id', reg.reg_id)
      .eq('session_id', sessionId)
      .maybeSingle()
    if (existing && existing.status === e.status) {
      skipped++
      continue
    }
    await writeAttendance(db, {
      registrationId: reg.reg_id,
      sessionId,
      status: e.status,
      captureMethod: 'manual',
      checkedInAt: e.status === 'attended' || e.status === 'left_early' ? nowIso() : null,
    })
    await db
      .from('workshop_registrations')
      .update({ attended: e.status === 'attended' || e.status === 'left_early' })
      .eq('reg_id', reg.reg_id)
    written++
  }
  return { written, skipped }
}

export interface WalkInInput {
  name: string
  email?: string | null
  phone?: string | null
  chosen_delivery?: 'in_person' | 'virtual'
  /** SETTLED model (D-3): the ONE marketing fact; signing in covers this workshop's comms. */
  marketing_opt_in?: boolean
  session_id?: string
}

export interface WalkInResult {
  registration_id: string
  session_id: string | null
}

/**
 * Add a walk-in at the kiosk: create a workshop_registrations row (flagged is_walk_in,
 * lead_source='walk-in') + an 'attended' attendance row (capture_method='checkin').
 * SETTLED consent model: the walk-in sheet IS this person's one-time signup — the
 * registration covers this workshop's comms; the ONE optional box is post-event
 * marketing, stamped on the row with the capture time + form version.
 */
export async function addWalkIn(
  db: Db,
  workshopId: string,
  input: WalkInInput,
  meta: { ip?: string | null; userAgent?: string | null; disclosureText: string; disclosureVersion: string },
): Promise<WalkInResult> {
  // Resolve session (provided, else the workshop's default session).
  let sessionId = input.session_id ?? null
  if (!sessionId) {
    const { data: s } = await db
      .from('workshop_sessions')
      .select('id')
      .eq('workshop_id', workshopId)
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    sessionId = s?.id ?? null
  }

  const channels = ['email', ...(input.phone ? ['sms'] : [])].filter(
    (c) => (c === 'email' ? !!input.email : true),
  ) as ('email' | 'sms')[]
  const joinToken = randomUUID()

  const { data: reg, error } = await db
    .from('workshop_registrations')
    .insert({
      workshop_id: workshopId,
      session_id: sessionId,
      name: input.name,
      email: input.email ? input.email.toLowerCase() : null,
      phone: input.phone || null,
      chosen_delivery: input.chosen_delivery ?? 'in_person',
      consent_channels: channels,
      lead_source: 'walk-in',
      is_walk_in: true,
      join_token: joinToken,
      status: 'registered',
      marketing_opt_in: input.marketing_opt_in === true,
      consent_captured_at: nowIso(),
      consent_form_version: `${SIGNUP_FORM_VERSION} · walk-in`,
    })
    .select('reg_id')
    .single()
  if (error || !reg) throw new Error(error?.message ?? 'Walk-in registration failed')

  if (channels.length > 0) {
    await db.from('workshop_consent_events').insert(
      channels.map((channel) => ({
        registration_id: reg.reg_id,
        channel,
        action: 'granted',
        disclosure_text: channel === 'sms' ? SMS_REMINDER_DISCLOSURE : `${meta.disclosureText} ${EMAIL_REMINDER_BASIS}`,
        disclosure_version: `${SIGNUP_FORM_VERSION} · walk-in · ${meta.disclosureVersion}`,
        ip_address: meta.ip ?? null,
        user_agent: meta.userAgent ?? null,
      })),
    )
  }
  if (input.marketing_opt_in === true && channels.length > 0) {
    await db.from('workshop_consent_events').insert(
      channels.map((channel) => ({
        registration_id: reg.reg_id,
        channel,
        action: 'granted',
        disclosure_text: MARKETING_OPT_IN_LABEL,
        disclosure_version: `${SIGNUP_FORM_VERSION} · walk-in · marketing`,
        ip_address: meta.ip ?? null,
        user_agent: meta.userAgent ?? null,
      })),
    )
  }

  if (sessionId) {
    await writeAttendance(db, {
      registrationId: reg.reg_id,
      sessionId,
      status: 'attended',
      captureMethod: 'checkin',
      checkedInAt: nowIso(),
    })
    await db.from('workshop_registrations').update({ attended: true }).eq('reg_id', reg.reg_id)
  }

  return { registration_id: reg.reg_id, session_id: sessionId }
}

// ─── Convert an attendee to a lead (P1, manual) ─────────────────────────────────
// Non-securities: mark the registration as a converted FSOS lead (lead_converted_at).
// is_security workshops are FIREWALLED: their attendees route to the FFS-supervised path
// (compliance escalation), NEVER the automated comms engine.
//
// GHL excision (Pre-Phase-2): the former GoHighLevel contact/opportunity push was removed.
// The FSOS-native lead artifacts are unaffected — the internal referral is created by the
// nurture caller (routeSegmentToSpine → `referrals`), and the conversion is marked natively
// here on the registration. No external pipeline placement is performed (there is no native
// opportunity spine wired for workshop/referral leads; see the excision completion report).

export interface WorkshopLeadContext {
  is_security: boolean | null
  slug: string | null
  title: string | null
}

export interface RegForConvert {
  reg_id: string
  name: string | null
  email: string | null
  phone: string | null
  /** Native conversion marker — set → already converted (idempotent). */
  lead_converted_at: string | null
}

export type ConvertLeadOutcome =
  | { ok: true; routed: 'native'; converted: boolean; skipped: boolean }
  | { ok: true; routed: 'ffs'; reason: string }
  | { ok: false; error: string; status: number }

/**
 * Route a workshop attendee into the consult spine. Returns the routing decision so the
 * caller can audit it. Does NOT create the internal referral (the caller owns the existing
 * referral-spine step); this marks the native conversion + handles the securities firewall.
 */
export async function convertRegistrationToLead(
  db: Db,
  reg: RegForConvert,
  ctx: WorkshopLeadContext,
  actor: string,
  // Retained for signature compatibility with the nurture caller (per-segment context tag).
  // No longer used to drive an external push; segment tagging/scoring stays with the caller.
  _extraTags: string[] = [],
): Promise<ConvertLeadOutcome> {
  // ── Securities firewall: route to FFS, never the automated engine. ──
  if (ctx.is_security === true) {
    await db.from('compliance_events').insert({
      kind: 'firewall',
      actor,
      entity_type: 'workshop_registration',
      entity_id: reg.reg_id,
      blocked_step: 'workshop_convert_to_lead',
      reason: 'Securities-flagged workshop — attendee routed to the FFS-supervised path, not the automated comms engine.',
    })
    await db.from('agent_actions').insert({
      kind: 'escalation',
      actor,
      outcome: 'escalated',
      target_type: 'workshop_registration',
      target_id: reg.reg_id,
      reason: 'is_security workshop',
      note: 'Convert-to-lead on a securities workshop routes to FFS. No automated comms.',
    })
    return { ok: true, routed: 'ffs', reason: 'securities_ffs' }
  }

  // ── Non-securities: mark the native conversion (idempotent). ──
  if (reg.lead_converted_at) {
    // Idempotent: already converted.
    return { ok: true, routed: 'native', converted: true, skipped: true }
  }
  const { error } = await db
    .from('workshop_registrations')
    .update({ lead_converted_at: new Date().toISOString() })
    .eq('reg_id', reg.reg_id)
  if (error) {
    // Fail closed: a transient write failure leaves the registration unconverted so the
    // caller can retry, rather than reporting a phantom conversion (no silent success).
    return { ok: false, error: error.message, status: 500 }
  }
  return { ok: true, routed: 'native', converted: true, skipped: false }
}

// ─── Virtual delivery: Zoom attendance webhook + provisioning (P3) ──────────────

/** Read the config-default left_early threshold (assumption-badged) from the singleton. */
export async function getLeftEarlyThresholdMinutes(db: Db): Promise<number> {
  const { data } = await db
    .from('workshop_comms_config')
    .select('left_early_threshold_minutes')
    .eq('id', 'global')
    .maybeSingle()
  const v = data?.left_early_threshold_minutes
  return typeof v === 'number' && v >= 0 ? v : 10
}

export interface WebhookTarget {
  registrationId: string
  sessionId: string
  workshopId: string
}

/**
 * Correlate a verified Zoom participant event to a (registration, session) by the stored
 * registrant TOKEN — never by display name (§5). Resolution order:
 *   1. session by workshop_sessions.zoom_meeting_id = event.meetingId,
 *   2. registration by zoom_registrant_id (primary) within that workshop,
 *   3. fallback: exact email match scoped to that workshop (still not a name match).
 * Returns null when it cannot be correlated (the route logs + ignores — no orphan writes).
 */
export async function resolveWebhookTarget(
  db: Db,
  event: ParsedParticipantEvent,
): Promise<WebhookTarget | null> {
  if (!event.meetingId) return null
  const { data: session } = await db
    .from('workshop_sessions')
    .select('id, workshop_id')
    .eq('zoom_meeting_id', event.meetingId)
    .maybeSingle()
  if (!session) return null

  let reg: { reg_id: string; session_id: string | null } | null = null
  if (event.registrantId) {
    const { data } = await db
      .from('workshop_registrations')
      .select('reg_id, session_id')
      .eq('workshop_id', session.workshop_id)
      .eq('zoom_registrant_id', event.registrantId)
      .maybeSingle()
    reg = data ?? null
  }
  if (!reg && event.email) {
    const { data } = await db
      .from('workshop_registrations')
      .select('reg_id, session_id')
      .eq('workshop_id', session.workshop_id)
      .eq('email', event.email)
      .maybeSingle()
    reg = data ?? null
  }
  if (!reg) return null

  return {
    registrationId: reg.reg_id,
    sessionId: reg.session_id ?? session.id,
    workshopId: session.workshop_id,
  }
}

export type WebhookAttendanceOutcome =
  | { action: 'skip'; reason: 'manual_precedence' | 'no_change' }
  | { action: 'write'; status: AttendanceStatus }

/**
 * Apply a Zoom participant event to the single attendance row for (registration, session).
 * Idempotent + manual-precedence-aware (deriveWebhookAttendance): duplicate/reconnect events
 * collapse to one correct row; a staff manual mark is NEVER clobbered by a late webhook
 * event. Writes capture_method='webhook' with merged join/leave/duration. The route audits.
 */
export async function applyWebhookAttendance(
  db: Db,
  target: WebhookTarget,
  event: ParsedParticipantEvent,
  thresholdMin: number,
): Promise<WebhookAttendanceOutcome> {
  const { data: existing } = await db
    .from('workshop_attendance')
    .select('status, capture_method, join_time, leave_time, duration_min')
    .eq('registration_id', target.registrationId)
    .eq('session_id', target.sessionId)
    .maybeSingle()

  const decision = deriveWebhookAttendance(
    existing
      ? {
          status: existing.status,
          capture_method: existing.capture_method,
          join_time: existing.join_time,
          leave_time: existing.leave_time,
          duration_min: existing.duration_min,
        }
      : null,
    { joinTime: event.joinTime, leaveTime: event.leaveTime },
    thresholdMin,
  )

  if (decision.action === 'skip') return decision

  await db.from('workshop_attendance').upsert(
    {
      registration_id: target.registrationId,
      session_id: target.sessionId,
      status: decision.row.status,
      capture_method: 'webhook',
      join_time: decision.row.join_time,
      leave_time: decision.row.leave_time,
      duration_min: decision.row.duration_min,
    },
    { onConflict: 'registration_id,session_id' },
  )
  // Keep the legacy registration.attended flag in sync for back-compat readers.
  await db
    .from('workshop_registrations')
    .update({ attended: decision.row.status === 'attended' || decision.row.status === 'left_early' })
    .eq('reg_id', target.registrationId)

  return { action: 'write', status: decision.row.status }
}

export type EnsureMeetingOutcome =
  | { ok: true; created: boolean; skipped: boolean; meetingId: string | null; reason: string }
  | { ok: false; reason: string }

/**
 * Idempotently CREATE the Zoom meeting a virtual/hybrid session needs so its registrants
 * have a room to join (spec §5; fixes the "no meeting was ever created" gap). Reuses the
 * shared S2S OAuth client (createZoomMeeting) — no new integration. Decision is the pure
 * decideSessionMeetingProvision gate:
 *   - in-person session            → skip (not_virtual)
 *   - already has zoom_meeting_id   → skip (already) — NEVER creates a duplicate on re-run
 *   - Zoom unconfigured             → skip (zoom_disabled) — a clean no-op, booking/register still succeed
 * On the create path, persists meeting id + uuid + join/start/passcode/dial-in on the session.
 * start_url is HOST-ONLY: stored in zoom_start_url, never returned here and never logged.
 * Best-effort: a transient Zoom API failure returns { ok:false, reason } so the staff
 * /provision-zoom retry can re-run later — the session is never left half-created.
 */
export async function ensureSessionZoomMeeting(
  db: Db,
  sessionId: string,
  topic: string,
): Promise<EnsureMeetingOutcome> {
  const { data: session } = await db
    .from('workshop_sessions')
    .select('id, workshop_id, starts_at, ends_at, timezone, delivery_mode, zoom_meeting_id')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session) return { ok: false, reason: 'session_not_found' }

  const decision = decideSessionMeetingProvision({
    deliveryMode: session.delivery_mode,
    existingMeetingId: session.zoom_meeting_id,
    zoomEnabled: zoomEnabled(),
  })
  if (!decision.create) {
    return { ok: true, created: false, skipped: true, meetingId: session.zoom_meeting_id ?? null, reason: decision.reason }
  }

  // Duration from the session window; default to a 60-minute config default when ends_at is unset.
  let durationMinutes = 60
  if (session.ends_at) {
    const mins = Math.round((new Date(session.ends_at).getTime() - new Date(session.starts_at).getTime()) / 60000)
    if (Number.isFinite(mins) && mins > 0) durationMinutes = mins
  }

  const meeting = await createZoomMeeting({
    topic: topic || 'Workshop',
    startTime: session.starts_at,
    durationMinutes,
    timezone: session.timezone || 'America/Chicago',
  })
  if (!meeting.ok) return { ok: false, reason: meeting.error ?? 'zoom_create_failed' }

  await db
    .from('workshop_sessions')
    .update({
      zoom_meeting_id: meeting.meetingId,
      zoom_meeting_uuid: meeting.uuid ?? null,
      zoom_join_url: meeting.joinUrl ?? null,
      zoom_start_url: meeting.startUrl ?? null, // HOST-ONLY column; never returned to a client or logged
      zoom_passcode: meeting.passcode ?? null,
      zoom_dial_in: meeting.dialIn ?? null,
      updated_at: nowIso(),
    })
    .eq('id', session.id)

  return { ok: true, created: true, skipped: false, meetingId: meeting.meetingId ?? null, reason: 'created' }
}

export interface CancelMeetingsResult {
  deleted: number
  failed: number
}

/**
 * Delete every Zoom meeting attached to a workshop's sessions (cancel path — no stale links).
 * Best-effort + gated: a no-op when Zoom is unconfigured. Clears the session Zoom columns on
 * a successful delete; a 404 (already gone) is treated as success by deleteZoomMeeting. A
 * transient delete failure is counted (caller may audit) but never blocks the cancellation.
 */
export async function cancelWorkshopZoomMeetings(db: Db, workshopId: string): Promise<CancelMeetingsResult> {
  const result: CancelMeetingsResult = { deleted: 0, failed: 0 }
  if (!zoomEnabled()) return result
  const { data: sessions } = await db
    .from('workshop_sessions')
    .select('id, zoom_meeting_id')
    .eq('workshop_id', workshopId)
    .not('zoom_meeting_id', 'is', null)
  for (const s of (sessions ?? []) as { id: string; zoom_meeting_id: string | null }[]) {
    const z = await deleteZoomMeeting(s.zoom_meeting_id)
    if (!z.ok) {
      result.failed++
      continue
    }
    await db
      .from('workshop_sessions')
      .update({
        zoom_meeting_id: null,
        zoom_meeting_uuid: null,
        zoom_join_url: null,
        zoom_start_url: null,
        zoom_passcode: null,
        zoom_dial_in: null,
        updated_at: nowIso(),
      })
      .eq('id', s.id)
    result.deleted++
  }
  return result
}

export type ProvisionOutcome =
  | { ok: true; joinUrl: string | null; skipped: boolean; reason?: string }
  | { ok: false; reason: string }

/**
 * Provision a per-registrant Zoom join link for a virtual/hybrid-virtual registration and
 * store the join_url + zoom_registrant_id (webhook correlation key). Best-effort + idempotent:
 *   - skips (ok:true) when the registration is not virtual, already provisioned, Zoom is
 *     disabled, or the session has no zoom_meeting_id — the registration is never blocked;
 *   - returns ok:false with a reason on a transient Zoom API failure so a retry can re-run
 *     later (the join_url is provisioned on retry, never lost).
 */
export async function provisionZoomForRegistration(db: Db, regId: string): Promise<ProvisionOutcome> {
  const { data: reg } = await db
    .from('workshop_registrations')
    .select('reg_id, name, email, session_id, chosen_delivery, join_url, zoom_registrant_id, workshop_id')
    .eq('reg_id', regId)
    .maybeSingle()
  if (!reg) return { ok: false, reason: 'registration_not_found' }
  if (reg.join_url && reg.zoom_registrant_id) return { ok: true, joinUrl: reg.join_url, skipped: true, reason: 'already_provisioned' }
  if (!reg.email) return { ok: true, joinUrl: null, skipped: true, reason: 'no_email' }

  const { data: session } = await db
    .from('workshop_sessions')
    .select('id, delivery_mode, zoom_meeting_id')
    .eq('id', reg.session_id ?? '')
    .maybeSingle()
  const sess = session ?? (await earliestSession(db, reg.workshop_id))
  if (!sess) return { ok: true, joinUrl: null, skipped: true, reason: 'no_session' }

  const isVirtual =
    sess.delivery_mode === 'virtual' || (sess.delivery_mode === 'hybrid' && reg.chosen_delivery === 'virtual')
  if (!isVirtual) return { ok: true, joinUrl: null, skipped: true, reason: 'not_virtual' }
  if (!zoomEnabled()) return { ok: true, joinUrl: null, skipped: true, reason: 'zoom_disabled' }
  if (!sess.zoom_meeting_id) return { ok: true, joinUrl: null, skipped: true, reason: 'no_meeting_id' }

  const [firstName, ...rest] = (reg.name ?? 'Guest').trim().split(/\s+/)
  const res = await addZoomRegistrant({
    // The session stores a Zoom meeting id; webinar provisioning would need a session-level
    // webinar flag (not modelled today) — default to the meeting registrants endpoint.
    meetingId: sess.zoom_meeting_id,
    kind: 'meeting',
    email: reg.email,
    firstName: firstName || 'Guest',
    lastName: rest.join(' ') || null,
  })
  if (!res.ok) return { ok: false, reason: res.error ?? 'provision_failed' }

  await db
    .from('workshop_registrations')
    .update({ join_url: res.joinUrl ?? null, zoom_registrant_id: res.registrantId ?? null })
    .eq('reg_id', reg.reg_id)
  return { ok: true, joinUrl: res.joinUrl ?? null, skipped: false }
}

async function earliestSession(
  db: Db,
  workshopId: string,
): Promise<{ id: string; delivery_mode: string | null; zoom_meeting_id: string | null } | null> {
  const { data } = await db
    .from('workshop_sessions')
    .select('id, delivery_mode, zoom_meeting_id')
    .eq('workshop_id', workshopId)
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// ─── Staff delivery panel summary (P3 ops UI) ───────────────────────────────────

export interface DeliverySessionLite {
  id: string
  starts_at: string
  delivery_mode: string | null
  zoom_meeting_id: string | null
  recording_url: string | null
  recording_expires_at: string | null
  status: string | null
}

export interface DeliverySummary {
  sessions: DeliverySessionLite[]
  hasVirtual: boolean
  virtualRegs: number
  provisioned: number
  captureCounts: { webhook: number; checkin: number; manual: number }
  feedback: { count: number; avgRating: number | null; consultRequested: number }
  recordingConsentApproved: boolean
  zoomEnabled: boolean
}

/**
 * Aggregate the P3 delivery status for one workshop's staff detail panel: sessions +
 * Zoom/recording pointers, per-registrant provisioning progress (virtual regs vs those with
 * a join_url), attendance capture-method mix (webhook/checkin/manual), post-event feedback
 * rollup, and whether an approved recording-consent disclosure exists (replay activation
 * gate). Read-only; every figure comes from real rows (no placeholders).
 */
export async function loadDeliverySummary(db: Db, workshopId: string): Promise<DeliverySummary> {
  const { data: sessionRows } = await db
    .from('workshop_sessions')
    .select('id, starts_at, delivery_mode, zoom_meeting_id, recording_url, recording_expires_at, status')
    .eq('workshop_id', workshopId)
    .order('starts_at', { ascending: true })
  const sessions = (sessionRows ?? []) as DeliverySessionLite[]
  const hasVirtual = sessions.some((s) => s.delivery_mode === 'virtual' || s.delivery_mode === 'hybrid')

  const { count: virtualRegs } = await db
    .from('workshop_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('workshop_id', workshopId)
    .eq('chosen_delivery', 'virtual')
  const { count: provisioned } = await db
    .from('workshop_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('workshop_id', workshopId)
    .not('join_url', 'is', null)

  // Registration ids for this workshop scope the attendance + feedback rollups.
  const { data: regRows } = await db
    .from('workshop_registrations')
    .select('reg_id')
    .eq('workshop_id', workshopId)
  const regIds = ((regRows ?? []) as { reg_id: string }[]).map((r) => r.reg_id)

  const captureCounts = { webhook: 0, checkin: 0, manual: 0 }
  const feedback = { count: 0, avgRating: null as number | null, consultRequested: 0 }
  if (regIds.length > 0) {
    const { data: att } = await db
      .from('workshop_attendance')
      .select('capture_method')
      .in('registration_id', regIds)
    for (const a of (att ?? []) as { capture_method: string | null }[]) {
      if (a.capture_method === 'webhook') captureCounts.webhook++
      else if (a.capture_method === 'checkin') captureCounts.checkin++
      else if (a.capture_method === 'manual') captureCounts.manual++
    }

    const { data: fb } = await db
      .from('workshop_feedback')
      .select('rating, consult_requested')
      .in('registration_id', regIds)
    const rows = (fb ?? []) as { rating: number | null; consult_requested: boolean | null }[]
    feedback.count = rows.length
    feedback.consultRequested = rows.filter((r) => r.consult_requested).length
    const rated = rows.map((r) => r.rating).filter((n): n is number => typeof n === 'number')
    feedback.avgRating = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null
  }

  const { data: rec } = await db
    .from('workshop_disclosure_configs')
    .select('id')
    .eq('kind', 'recording')
    .eq('is_assumption', false)
    .not('approved_by', 'is', null)
    .limit(1)
    .maybeSingle()

  return {
    sessions,
    hasVirtual,
    virtualRegs: virtualRegs ?? 0,
    provisioned: provisioned ?? 0,
    captureCounts,
    feedback,
    recordingConsentApproved: !!rec,
    zoomEnabled: zoomEnabled(),
  }
}

/**
 * Mint a short-lived signed URL for a private-bucket asset path (hero image / headshot).
 * Public landing pages call this at render time (force-dynamic) so images stay in the
 * private `documents` bucket and are never exposed as public URLs.
 */
export async function signedAssetUrl(db: Db, path: string | null, ttl = 60 * 60): Promise<string | null> {
  if (!path) return null
  try {
    const { data } = await db.storage.from('documents').createSignedUrl(path, ttl)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}
