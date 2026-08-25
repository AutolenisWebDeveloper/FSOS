// src/lib/booking/manage.ts
// Self-service reschedule/cancel for native bookings (Slice 6). Reached only via a signed,
// expiring, single-purpose manage token (manage-tokens.ts) — no id is ever exposed in the
// link. Both operations are atomic on the spine and keep the Zoom meeting in lock-step:
//   • cancel  → status scheduled→cancelled (frees the slot via the partial unique index,
//               mig 069), deletes the Zoom meeting, notifies, audited.
//   • resched → a single UPDATE moves starts_at to the new slot; the same unique index makes
//               a concurrent claim of the new slot lose cleanly ("just taken"), while the old
//               slot is freed by the move — claim-new-and-free-old in one statement. The Zoom
//               meeting time is updated, the confirmation re-sent, and the change audited.
// Comms is consumed via notify.ts (never modified); Zoom steps are gated no-ops when Zoom is
// unconfigured.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { setAppointmentStatus } from '@/lib/appointments/service'
import { deleteZoomMeeting, updateZoomMeeting } from '@/lib/zoom/client'
import { verifyManageToken, manageTokenKey, type ManagePurpose } from './manage-tokens'
import { computeSlotsForType } from './slots'
import { isSlotCollision } from './insert-errors'
import { sendAppointmentNotice } from './notify'

export interface ManagedAppointment {
  id: string
  appointment_type_id: string | null
  starts_at: string | null
  ends_at: string | null
  duration_minutes: number | null
  booker_timezone: string | null
  status: string
  meeting_mode: string | null
  zoom_meeting_id: string | null
  schedule_version: number | null
}

const MANAGE_SELECT =
  'id, appointment_type_id, starts_at, ends_at, duration_minutes, booker_timezone, status, meeting_mode, zoom_meeting_id, schedule_version, ' +
  'appointment_types:appointment_type_id(slug, name)'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = ReturnType<typeof getDb>

export type ResolveResult =
  | { ok: true; purpose: ManagePurpose; appt: ManagedAppointment; typeSlug: string | null; typeName: string | null }
  | { ok: false; kind: 'invalid' | 'not_found' }

/** Resolve a signed manage token to its appointment (by the purpose's opaque token column). */
export async function resolveManageToken(signedToken: string): Promise<ResolveResult> {
  const v = verifyManageToken(signedToken, manageTokenKey())
  if (!v) return { ok: false, kind: 'invalid' }
  const db = getDb()
  const column = v.purpose === 'cancel' ? 'cancel_token' : 'reschedule_token'
  const { data } = await db.from('appointments').select(MANAGE_SELECT).eq(column, v.opaqueToken).maybeSingle()
  if (!data) return { ok: false, kind: 'not_found' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any
  const type = Array.isArray(row.appointment_types) ? row.appointment_types[0] : row.appointment_types
  return {
    ok: true,
    purpose: v.purpose,
    appt: row as ManagedAppointment,
    typeSlug: type?.slug ?? null,
    typeName: type?.name ?? null,
  }
}

/**
 * Resolve an appointment for an authenticated (non-token) reschedule — by id, with the same
 * MANAGE_SELECT shape the token flow uses. Lets the FSA-side endpoint reuse the ONE shared
 * rescheduleAppointment mover instead of a second write path. RLS on the read still applies.
 */
export async function loadManagedAppointment(
  id: string,
): Promise<{ appt: ManagedAppointment; typeSlug: string | null } | null> {
  const db = getDb()
  const { data } = await db.from('appointments').select(MANAGE_SELECT).eq('id', id).maybeSingle()
  if (!data) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any
  const type = Array.isArray(row.appointment_types) ? row.appointment_types[0] : row.appointment_types
  return { appt: row as ManagedAppointment, typeSlug: type?.slug ?? null }
}

export type CancelResult =
  | { ok: true }
  | { ok: false; kind: 'not_cancellable' | 'error'; message: string }

/** Cancel a scheduled appointment: free the slot, delete the Zoom meeting, notify, audit. */
export async function cancelAppointment(appt: ManagedAppointment, reason?: string | null): Promise<CancelResult> {
  if (appt.status !== 'scheduled') {
    return { ok: false, kind: 'not_cancellable', message: 'This appointment can no longer be cancelled.' }
  }
  const db = getDb()
  // Frees the slot (only 'scheduled' rows occupy the unique index) + writes the audit.
  const res = await setAppointmentStatus('public', appt.id, 'cancelled', { note: reason ?? 'Cancelled by attendee' })
  if (!('ok' in res)) {
    return { ok: false, kind: 'error', message: 'Could not cancel the appointment.' }
  }
  await db
    .from('appointments')
    .update({ cancellation_reason: reason ?? 'Cancelled by attendee', updated_at: new Date().toISOString() })
    .eq('id', appt.id)

  // Best-effort side-effects: delete the Zoom meeting + send the cancellation notice.
  if (appt.meeting_mode === 'video') {
    const z = await deleteZoomMeeting(appt.zoom_meeting_id)
    if (!z.ok) {
      await writeAudit({ actor: 'public', action: 'config.changed', entity: 'appointment', entityId: appt.id, diff: { zoom_delete_failed: z.error ?? true } })
    }
  }
  try {
    await sendAppointmentNotice(appt.id, 'cancellation')
  } catch {
    /* best-effort — cancellation already committed */
  }
  return { ok: true }
}

export type RescheduleResult =
  | { ok: true; startsAt: string; endsAt: string }
  | { ok: false; kind: 'not_reschedulable' | 'unavailable' | 'taken' | 'error'; message: string }

/**
 * Reschedule to a new slot. Re-validates the requested slot against LIVE availability, then
 * atomically moves the appointment (the unique index guards against a racing claim of the new
 * slot). Updates the Zoom meeting time and re-sends the confirmation. `now` is injected for a
 * deterministic notice/lead re-check.
 */
export async function rescheduleAppointment(
  appt: ManagedAppointment,
  typeSlug: string | null,
  newStartsAt: string,
  now: string,
  actor: string,
): Promise<RescheduleResult> {
  if (appt.status !== 'scheduled') {
    return { ok: false, kind: 'not_reschedulable', message: 'This appointment can no longer be rescheduled.' }
  }
  if (!typeSlug) return { ok: false, kind: 'error', message: 'Appointment type is unavailable.' }
  const db = getDb()

  // Validate the new slot exactly as a fresh booking would (in-hours, notice/lead, blackout,
  // capacity, free) by computing over the single requested instant.
  const check = await computeSlotsForType({
    slug: typeSlug,
    rangeStart: newStartsAt,
    rangeEnd: newStartsAt,
    bookerTimezone: appt.booker_timezone || 'America/Chicago',
    now,
    // FSOS-042: don't let this appointment's current slot block its own reschedule.
    excludeAppointmentId: appt.id,
  })
  if (!check.ok) return { ok: false, kind: 'error', message: 'Could not check availability.' }
  const slot = check.slots.find((s) => s.startsAt === newStartsAt)
  if (!slot) return { ok: false, kind: 'unavailable', message: 'That time is not available. Please pick another.' }

  // Atomic move: the partial unique index (host_user_id, starts_at) WHERE status='scheduled'
  // rejects a collision with another live booking; the old slot is freed by the same update.
  const upd = await db
    .from('appointments')
    .update({
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      scheduled_at: slot.startsAt,
      // Re-anchor every notification to the new time by BUMPING schedule_version (P5, mig 093):
      // the delivery ledger is keyed by (appointment, schedule_version, event, offset, channel),
      // so a bumped version has no delivery rows yet → each configured reminder offset fires once
      // for the new slot (correct even if moved back to a previously-used time — the version
      // differs). `reminder_sent_at` is reset too, retained one release for rollback safety only
      // (the new ledger-backed reminder pass no longer reads it).
      schedule_version: (appt.schedule_version ?? 1) + 1,
      reminder_sent_at: null,
      updated_at: now,
    })
    .eq('id', appt.id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()
  if (upd.error) {
    // Both race guards mean "the slot was just taken": 23505 (identical start, unique index) AND
    // 23P01 (overlapping range, GiST exclusion mig 091/119). The INSERT path already classifies
    // both via isSlotCollision; reschedule now reuses it so an OVERLAP collision returns a clean
    // 'taken' (→ 409) instead of an opaque 500 (FSOS-041). A non-collision error still → 'error'.
    if (isSlotCollision(upd.error)) {
      return { ok: false, kind: 'taken', message: 'That time was just booked. Please pick another.' }
    }
    return { ok: false, kind: 'error', message: 'Could not reschedule.' }
  }
  if (!upd.data) return { ok: false, kind: 'not_reschedulable', message: 'This appointment can no longer be rescheduled.' }

  // Keep the Zoom meeting in lock-step (best-effort, gated no-op when unconfigured).
  if (appt.meeting_mode === 'video') {
    const z = await updateZoomMeeting(appt.zoom_meeting_id, {
      startTime: slot.startsAt,
      durationMinutes: appt.duration_minutes ?? 30,
    })
    if (!z.ok) {
      await writeAudit({ actor, action: 'config.changed', entity: 'appointment', entityId: appt.id, diff: { zoom_update_failed: z.error ?? true } })
    }
  }

  await writeAudit({
    actor,
    action: 'entity.updated',
    entity: 'appointment',
    entityId: appt.id,
    diff: { event: 'rescheduled', rescheduled_to: slot.startsAt, from: appt.starts_at },
  })

  // A reschedule is a `rescheduled` event — NOT a fresh "you're booked" confirmation (P5). The
  // approved appointment-rescheduled template announces the new time (grounded in the moved
  // starts_at via the enforced {{appointment_time}} token); the ledger fires it once for the
  // bumped schedule_version.
  try {
    await sendAppointmentNotice(appt.id, 'rescheduled', { actor })
  } catch {
    /* best-effort — reschedule already committed */
  }
  return { ok: true, startsAt: slot.startsAt, endsAt: slot.endsAt }
}
