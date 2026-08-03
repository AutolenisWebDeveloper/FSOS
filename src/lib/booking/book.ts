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
import { createZoomMeeting, zoomEnabled } from '@/lib/zoom/client'
import { sendBookingConfirmation } from './notify'
import { computeSlotsForType } from './slots'
import { notifyFsa, sendVisitorAck } from '@/lib/notifications/transactional'
import { BUSINESS, SMS_CONSENT, siteUrl } from '@/lib/site'
import { consentContactKey } from '@/lib/comms/contact-consent'
import { smsConsentVersion } from '@/lib/comms/consent-version'

export interface BookInput {
  typeSlug: string
  /** The chosen slot start, UTC ISO — must match a live availability slot. */
  startsAt: string
  bookerTimezone: string
  name: string
  email: string
  phone?: string | null
  notes?: string | null
  /**
   * Separate, affirmative SMS opt-in captured at booking (P5.3). NEVER inferred. When true (and
   * a valid phone is present, enforced by PublicBookingInput), the booking writes a durable SMS
   * consent grant to the store the send path reads. Absent/false ⇒ no SMS consent evidence.
   */
  smsOptIn?: boolean
  /** Server-derived consent evidence (TCPA/A2P) — the capture surface's request context. */
  ip?: string | null
  userAgent?: string | null
}

export interface BookingConfirmation {
  reference: string
  typeName: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  meetingMode: string
  bookerTimezone: string
  /** Client-facing Zoom join link when a video meeting was provisioned; else null. Never the start_url. */
  joinUrl: string | null
  /**
   * Meeting-link state for the UI copy: 'none' (phone/in-person), 'provisioned' (link ready),
   * or 'pending' (video but Zoom is unconfigured or provisioning is being retried).
   */
  meetingStatus: 'none' | 'provisioned' | 'pending'
}

export type BookResult =
  | { ok: true; confirmation: BookingConfirmation }
  | { ok: false; kind: 'not_found' | 'unavailable' | 'taken' | 'error'; message: string }

const UNIQUE_VIOLATION = '23505'
const CONSENT_DISCLOSURE_VERSION = 'booking-email-2026-07'

/** Human-readable local time for the notification body (best-effort; falls back to UTC). */
function formatLocal(startsAt: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'America/Chicago',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(startsAt))
  } catch {
    return new Date(startsAt).toUTCString()
  }
}

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

  // 4. Provision a Zoom meeting for VIDEO appointments (spec §5). Best-effort and gated on
  //    zoomEnabled(): if Zoom is unconfigured or the API fails, the booking still succeeds
  //    with meeting_mode recorded and the link left null for a later retry (never a hard
  //    failure — mirrors the workshop provision-zoom no-op). The client only ever receives
  //    join_url; start_url is FSA-only and is persisted but NEVER returned or logged.
  let joinUrl: string | null = null
  let meetingStatus: BookingConfirmation['meetingStatus'] = type.meeting_mode === 'video' ? 'pending' : 'none'
  if (type.meeting_mode === 'video' && zoomEnabled()) {
    const meeting = await createZoomMeeting({
      topic: type.name,
      startTime: slot.startsAt,
      durationMinutes: type.duration_minutes,
      timezone: input.bookerTimezone,
    })
    if (meeting.ok) {
      joinUrl = meeting.joinUrl ?? null
      meetingStatus = 'provisioned'
      await db
        .from('appointments')
        .update({
          zoom_meeting_id: meeting.meetingId,
          join_url: meeting.joinUrl,
          start_url: meeting.startUrl, // FSA-only column; never returned to the client
          dial_in: meeting.dialIn,
          updated_at: now,
        })
        .eq('id', appointmentId)
    }
    // meeting.ok === false → leave links null, meetingStatus stays 'pending' for retry.
  }

  // 5. Activity log + consent intent + audit (best-effort; the appointment already exists).
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

  // Booking a review exits any live campaign enrollment for this contact's household (spec §11 /
  // §4b — campaign outcome "Appointment Booked"): the client has engaged and the advisor now owns
  // the relationship, so both the Cross-Sell Life and Life Conversion cadences must stop.
  // Best-effort; a failure here never fails the booking (the appointment already exists).
  try {
    const { data: c } = await db.from('contacts').select('household_id').eq('id', contactId).maybeSingle()
    if (c?.household_id) {
      const householdId = c.household_id as string
      const [xsell, life] = await Promise.all([
        import('@/lib/cross-sell-life/inbound'),
        import('@/lib/life-campaign/inbound'),
      ])
      await Promise.allSettled([
        xsell.exitOnAppointment({ householdId, actor: 'booking' }),
        life.exitOnAppointment({ householdId, actor: 'booking' }),
      ])
    }
  } catch {
    /* best-effort — the appointment already exists */
  }
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

  // 5b. SEPARATE, AFFIRMATIVE SMS consent (P5.3 / TCPA / A2P 10DLC) — captured ONLY when the
  //     attendee affirmatively opted in AND a valid phone is present (both enforced by
  //     PublicBookingInput). NEVER inferred from booking or the email opt-in. The enforceable
  //     grant is a durable `granted` row in comm_contact_consents — the CONTACT-RESOLVABLE store
  //     the send path reads at gate time (send.ts → durableContactConsentGranted), the SAME store
  //     the public contact form and STOP/HELP already use (one SMS consent source of truth, §6;
  //     never a second path). The exact disclosure text + content-derived version are persisted
  //     as first-class TCPA evidence, mirrored to the append-only audit_log. An UNCHECKED box
  //     writes NO positive-consent row and enrolls nothing. No SMS is sent here (Stage 4, behind
  //     booking_reminder_config.sms_enabled).
  if (input.smsOptIn && input.phone) {
    const consentVersion = smsConsentVersion()
    await Promise.allSettled([
      db.from('comm_contact_consents').insert({
        contact: consentContactKey('sms', input.phone),
        channel: 'sms',
        action: 'granted',
        consent_text: SMS_CONSENT.disclosure, // exact wording shown at the checkbox (verbatim-synced)
        consent_version: consentVersion, // content-derived — proves the wording the booker saw
        source_url: `${siteUrl()}/schedule`,
        ip_address: input.ip ?? null,
        user_agent: input.userAgent ?? null,
        captured_at: now,
      }),
      db.from('activities').insert({
        entity_type: 'contact',
        entity_id: contactId,
        kind: 'consent_intent',
        note: `SMS booking-notification consent captured at booking (${consentVersion}).`,
        actor: 'public',
      }),
    ])
    // Immutable evidence-of-record (append-only, tamper-locked mig 077). Structured so a TCPA
    // dispute can reconstruct who/when/where/what-they-saw; phone stored as last-4 only (no PII
    // in the log). The enforceable read-path grant lives in comm_contact_consents above.
    await writeAudit({
      actor: 'public',
      action: 'consent.captured',
      entity: 'contact',
      entityId: contactId,
      diff: {
        channel: 'sms',
        scope: 'booking',
        granted: true,
        consentVersion,
        consentText: SMS_CONSENT.disclosure,
        sourceUrl: `${siteUrl()}/schedule`,
        ipAddress: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        phone_tail: input.phone.replace(/\D/g, '').slice(-4),
      },
    })
  }

  // 6. Notifications (best-effort — the appointment already exists, so nothing here can fail
  //    the booking). Two audiences:
  //    a) the BOOKER — the templated confirmation through the comms gate (Slice 5) when an
  //       approved appointment-confirmation template exists; otherwise a TRANSACTIONAL
  //       fallback so the booker always gets exactly one confirmation even before marketing
  //       templates are approved (the historical outage: templates seed as `draft`).
  //    b) the FSA — an internal "new booking" ops alert (reply-to the booker).
  const whenLocal = formatLocal(slot.startsAt, input.bookerTimezone)
  const meetingLine =
    type.meeting_mode === 'video'
      ? joinUrl
        ? `Video — join link: ${joinUrl}`
        : 'Video — join link to follow'
      : type.meeting_mode === 'phone'
        ? 'Phone call'
        : 'In person'
  try {
    let confirmationSent = false
    try {
      const outcome = await sendBookingConfirmation(appointmentId)
      confirmationSent = outcome.sent
    } catch {
      /* fall through to the transactional fallback below */
    }
    const notes: Promise<unknown>[] = []
    if (!confirmationSent) {
      notes.push(
        sendVisitorAck({
          to: input.email,
          subject: `Appointment confirmed — ${type.name}`,
          heading: `You're booked, ${input.name?.trim() || 'there'}.`,
          lede: `Your appointment with ${BUSINESS.agent}, ${BUSINESS.title} with ${BUSINESS.carrier}, is confirmed. Details are below.`,
          rows: [
            { label: 'Appointment', value: type.name },
            { label: 'When', value: whenLocal },
            { label: 'How', value: meetingLine },
            { label: 'Reference', value: reference },
          ],
          note: 'Need to reschedule or cancel? Reply to this email and we\'ll take care of it.',
        }),
      )
    }
    notes.push(
      notifyFsa({
        subject: `New booking — ${type.name} (${input.name})`,
        heading: 'New appointment booked',
        lede: `${input.name} booked “${type.name}” through the public scheduler.`,
        rows: [
          { label: 'Name', value: input.name },
          { label: 'Email', value: input.email },
          { label: 'Phone', value: input.phone ?? null },
          { label: 'Appointment', value: type.name },
          { label: 'When', value: whenLocal },
          { label: 'How', value: meetingLine },
          { label: 'Reference', value: reference },
          { label: 'Notes', value: input.notes ?? null },
        ],
        replyTo: input.email,
      }),
    )
    await Promise.allSettled(notes)
  } catch {
    /* best-effort — booking success is not contingent on any notification */
  }

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
      joinUrl, // attendee join link only — the FSA-only host link is never placed here
      meetingStatus,
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
