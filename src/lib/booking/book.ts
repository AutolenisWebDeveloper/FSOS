// src/lib/booking/book.ts
// Impure booking-submission service for the PUBLIC flow (Slice 3). Turns a validated
// booking request into a native `appointments` row on the spine:
//   1. re-validate the requested slot against live availability (never trust the client),
//   2. resolve-or-create a spine `contacts` row (dedupe on email/phone — never the legacy
//      `customers` table, never a parallel person record),
//   3. claim the slot ATOMICALLY via the DB unique index (mig 069) — a concurrent second
//      booking of the same (host, slot) loses cleanly ("just taken"), never double-books,
//   4. log the activity + capture booking consent intent + write the audit row.
//
// Securities firewall (§4.1): only scheduling metadata + a contact link are stored — no
// securities data, and the booking form never collects any. Comms is untouched here;
// confirmations/reminders are Slice 5 (they read consent downstream).

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { generateFormToken, referenceFromToken } from '@/lib/tokens'
import { emailLc, phoneDigits, deriveFullName } from '@/lib/contacts/normalize'
import { buildContactIndex, resolveContact, type CandidateContact } from '@/lib/import/resolution'
import { computeSlotsForType } from './slots'

export interface BookInput {
  typeSlug: string
  /** The chosen slot start, UTC ISO — must match a live availability slot. */
  startsAt: string
  bookerTimezone: string
  name: string
  email: string
  phone?: string | null
  notes?: string | null
}

export interface BookingConfirmation {
  reference: string
  typeName: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  meetingMode: string
  bookerTimezone: string
}

export type BookResult =
  | { ok: true; confirmation: BookingConfirmation }
  | { ok: false; kind: 'not_found' | 'unavailable' | 'taken' | 'error'; message: string }

const UNIQUE_VIOLATION = '23505'
const CONSENT_DISCLOSURE_VERSION = 'booking-email-2026-07'

/**
 * Book an appointment from a validated public request. `now` is injected (UTC ISO) so the
 * min-notice / max-lead re-validation is deterministic and testable.
 */
export async function bookAppointment(input: BookInput, now: string): Promise<BookResult> {
  const db = getDb()

  // 1. Re-validate the slot against LIVE availability. Computing over the single instant
  //    [startsAt, startsAt] returns the slot iff it is genuinely bookable right now
  //    (in-hours, not past/too-soon/too-far, not blacked out, under the daily cap, free).
  const check = await computeSlotsForType({
    slug: input.typeSlug,
    rangeStart: input.startsAt,
    rangeEnd: input.startsAt,
    bookerTimezone: input.bookerTimezone,
    now,
  })
  if (!check.ok) {
    if (check.kind === 'not_found' || check.kind === 'inactive') {
      return { ok: false, kind: 'not_found', message: 'That appointment type is not available.' }
    }
    return { ok: false, kind: 'error', message: check.message }
  }
  const type = check.type
  const slot = check.slots.find((s) => s.startsAt === input.startsAt)
  if (!slot) {
    return { ok: false, kind: 'unavailable', message: 'That time is no longer available. Please pick another.' }
  }

  // 2. Resolve-or-create the spine contact (dedupe on email/phone).
  let contactId: string
  try {
    contactId = await resolveOrCreateContact(db, input)
  } catch (e) {
    return { ok: false, kind: 'error', message: e instanceof Error ? e.message : 'Contact resolution failed' }
  }

  // 3. Claim the slot atomically. The partial unique index on (host_user_id, starts_at)
  //    WHERE status='scheduled' is the race guard — a duplicate raises 23505, which we turn
  //    into a clean "just taken" rather than a double-book or a 500.
  const cancelToken = generateFormToken()
  const rescheduleToken = generateFormToken()
  const bookingToken = generateFormToken()
  const ins = await db
    .from('appointments')
    .insert({
      appointment_type_id: type.id,
      contact_id: contactId,
      host_user_id: type.host_user_id,
      duration_minutes: type.duration_minutes,
      booker_timezone: input.bookerTimezone,
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
      scheduled_at: slot.startsAt, // keep in lock-step for legacy surfaces
      status: 'scheduled',
      booked_via: 'native',
      booked_at: now,
      meeting_mode: type.meeting_mode,
      booking_token: bookingToken,
      cancel_token: cancelToken,
      reschedule_token: rescheduleToken,
    })
    .select('id')
    .maybeSingle()

  if (ins.error) {
    if (ins.error.code === UNIQUE_VIOLATION) {
      return { ok: false, kind: 'taken', message: 'That time was just booked. Please pick another.' }
    }
    return { ok: false, kind: 'error', message: ins.error.message }
  }
  if (!ins.data) return { ok: false, kind: 'error', message: 'Booking could not be created.' }
  const appointmentId = ins.data.id

  // 4. Activity log + consent intent + audit (best-effort; the appointment already exists).
  const reference = referenceFromToken(cancelToken)
  await Promise.allSettled([
    db.from('activities').insert({
      entity_type: 'appointment',
      entity_id: appointmentId,
      kind: 'appointment_booked',
      note: `Booked “${type.name}” via the public scheduler${input.notes ? ` — note: ${input.notes.slice(0, 500)}` : ''}`,
      actor: 'public',
    }),
    // Booking through our own funnel is an email opt-in for booking-related mail only. We do
    // NOT infer SMS consent (TCPA requires express written consent). Slice 5 reads this.
    db.from('activities').insert({
      entity_type: 'contact',
      entity_id: contactId,
      kind: 'consent_intent',
      note: `Email booking-notification consent captured at booking (${CONSENT_DISCLOSURE_VERSION}).`,
      actor: 'public',
    }),
  ])
  await writeAudit({
    actor: 'public',
    action: 'entity.created',
    entity: 'appointment',
    entityId: appointmentId,
    diff: { via: 'native_public_booking', type: type.slug, starts_at: slot.startsAt },
  })
  await writeAudit({
    actor: 'public',
    action: 'consent.captured',
    entity: 'contact',
    entityId: contactId,
    diff: { channel: 'email', scope: 'booking', version: CONSENT_DISCLOSURE_VERSION },
  })

  return {
    ok: true,
    confirmation: {
      reference,
      typeName: type.name,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      durationMinutes: type.duration_minutes,
      meetingMode: type.meeting_mode,
      bookerTimezone: input.bookerTimezone,
    },
  }
}

/**
 * Resolve the booker to an existing spine contact (strong email/phone match) or create a
 * new prospect contact. Never blind-merges on a name-only/ambiguous match — a public booker
 * with only a shared name creates a fresh contact (dedupe is detected, not enforced).
 */
async function resolveOrCreateContact(
  db: ReturnType<typeof getDb>,
  input: BookInput,
): Promise<string> {
  const el = emailLc(input.email)
  const pd = phoneDigits(input.phone)

  let candidates: CandidateContact[] = []
  if (el || pd) {
    const ors: string[] = []
    if (el) ors.push(`email_lc.eq.${el}`)
    if (pd) ors.push(`phone_digits.eq.${pd}`)
    const { data } = await db
      .from('contacts')
      .select('id, full_name, email_lc, phone_digits')
      .is('deleted_at', null)
      .or(ors.join(','))
      .limit(50)
    candidates = (data ?? []) as CandidateContact[]
  }

  const index = buildContactIndex(candidates)
  const res = resolveContact(index, { email: input.email, phone: input.phone ?? null, fullName: input.name })
  if (res.action === 'merge' && res.targetId) return res.targetId

  const fullName = deriveFullName({ full: input.name, email: input.email, phone: input.phone ?? null })
  const { data, error } = await db
    .from('contacts')
    .insert({
      full_name: fullName,
      email: input.email || null,
      email_lc: el,
      phone: input.phone || null,
      phone_digits: pd,
      contact_type: 'prospect',
      status: 'active',
      source: 'schedule',
      created_by: 'public',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Failed to create contact')
  return data.id
}
