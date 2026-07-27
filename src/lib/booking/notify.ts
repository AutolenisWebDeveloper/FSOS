// src/lib/booking/notify.ts
// Booking notifications (Slice 5) — confirmation on booking + a pre-appointment reminder,
// both routed through the EXISTING comms platform via sendThroughGate. Comms code is
// consumed, never modified: the 7-step gate (consent, quiet-hours, DNC, approved-template,
// recommendation, securities) is re-checked at send time exactly as for any other send.
//
// Booking contacts are spine `contacts` with no household_member, so consent enters the gate
// through `durableConsentGranted` (the workshop non-member pattern) — email only; SMS consent
// is never inferred. The email body is the STORED, approved appointment template (ADR-025);
// the specific time + join link are merge tokens grounded at send time, never baked in.

import { getDb } from '@/lib/supabase/client'
import { unwrapOne } from '@/lib/data/query'
import { CONTACT, siteUrl } from '@/lib/site'
import { sendThroughGate } from '@/lib/comms/send'
import { signManageToken, manageTokenKey, MANAGE_TOKEN_TTL_MS } from './manage-tokens'
import {
  buildBookingContext,
  isReminderDue,
  DEFAULT_REMINDER_LEAD_HOURS,
  type ReminderCandidate,
} from './notify-core'

const OFFICE_LOCATION = `${CONTACT.address.line1}, ${CONTACT.address.city}, ${CONTACT.address.region} ${CONTACT.address.postal}`

/** Reminder lead (hours before start). Configurable; defaults to 24h. */
export function reminderLeadHours(): number {
  const raw = Number.parseInt(process.env.BOOKING_REMINDER_LEAD_HOURS || '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REMINDER_LEAD_HOURS
}

interface ContactRow {
  full_name: string | null
  first_name: string | null
  email: string | null
  phone: string | null
}
interface TypeRow {
  name: string | null
  meeting_mode: string | null
}
interface ApptRow {
  id: string
  contact_id: string | null
  starts_at: string | null
  booker_timezone: string | null
  meeting_mode: string | null
  join_url: string | null
  booked_at: string | null
  status: string
  reminder_sent_at: string | null
  cancel_token: string | null
  reschedule_token: string | null
  contacts: ContactRow | ContactRow[] | null
  appointment_types: TypeRow | TypeRow[] | null
}

const APPT_SELECT =
  'id, contact_id, starts_at, booker_timezone, meeting_mode, join_url, booked_at, status, reminder_sent_at, ' +
  'cancel_token, reschedule_token, ' +
  'contacts:contact_id(full_name, first_name, email, phone), appointment_types:appointment_type_id(name, meeting_mode)'

/** Signed, expiring reschedule/cancel manage links for the email (Slice 6). Empty when the
 *  appointment carries no self-service token (e.g. a review-created appointment). */
function manageUrls(appt: ApptRow): { reschedule_url: string; cancel_url: string } {
  const key = manageTokenKey()
  const exp = Date.now() + MANAGE_TOKEN_TTL_MS
  const base = siteUrl()
  return {
    reschedule_url: appt.reschedule_token
      ? `${base}/schedule?manage=${encodeURIComponent(signManageToken(appt.reschedule_token, 'reschedule', exp, key))}`
      : '',
    cancel_url: appt.cancel_token
      ? `${base}/schedule?manage=${encodeURIComponent(signManageToken(appt.cancel_token, 'cancel', exp, key))}`
      : '',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = ReturnType<typeof getDb>

/** The latest APPROVED, non-archived stored template for a source key (gate step 4). */
async function loadApprovedTemplate(db: Db, sourceKey: string) {
  const { data } = await db
    .from('comm_templates')
    .select('id, subject, body, body_text')
    .eq('source_key', sourceKey)
    .eq('approval_status', 'approved')
    .is('archived_at', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as { id: string; subject: string | null; body: string; body_text: string | null } | null
}

export type NotifyOutcome = { sent: boolean; reason?: string }

/** Send one appointment email (confirmation or reminder) through the gate. */
async function sendAppointmentEmail(
  db: Db,
  opts: { sourceKey: string; appt: ApptRow; actor: string; durableConsentGranted: boolean },
): Promise<NotifyOutcome> {
  const contact = unwrapOne(opts.appt.contacts)
  const type = unwrapOne(opts.appt.appointment_types)
  if (!contact?.email) return { sent: false, reason: 'no_email' }
  if (!opts.appt.starts_at) return { sent: false, reason: 'no_start' }

  // Deferred if the template isn't approved yet (mirrors the workshop template-not-approved
  // deferral) — booking itself already succeeded; the email simply waits for approval.
  const tpl = await loadApprovedTemplate(db, opts.sourceKey)
  if (!tpl) return { sent: false, reason: 'template_not_approved' }

  const ctx = buildBookingContext({
    fullName: contact.full_name,
    startsAt: opts.appt.starts_at,
    bookerTimezone: opts.appt.booker_timezone,
    meetingMode: opts.appt.meeting_mode ?? type?.meeting_mode ?? 'video',
    joinUrl: opts.appt.join_url,
    phone: contact.phone,
    location: OFFICE_LOCATION,
  })

  const outcome = await sendThroughGate({
    channel: 'email',
    to: contact.email,
    subject: tpl.subject ?? undefined,
    body: tpl.body,
    bodyText: tpl.body_text ?? undefined,
    templateId: tpl.id,
    durableConsentGranted: opts.durableConsentGranted, // email booking consent (non-member)
    isSecurity: false,
    actor: opts.actor,
    entity: { type: 'appointment', id: opts.appt.id },
    // Merge context + signed reschedule/cancel manage links (unused tokens render empty).
    recipientContext: { ...ctx, ...manageUrls(opts.appt) },
  })
  return { sent: outcome.sent, reason: outcome.sent ? undefined : outcome.reason ?? 'gate_blocked' }
}

/**
 * Send the booking confirmation. Best-effort — the appointment already exists; a deferred or
 * blocked email never fails the booking. Called right after a successful booking.
 */
export async function sendBookingConfirmation(appointmentId: string): Promise<NotifyOutcome> {
  const db = getDb()
  const { data } = await db.from('appointments').select(APPT_SELECT).eq('id', appointmentId).maybeSingle()
  if (!data) return { sent: false, reason: 'not_found' }
  // The booker just opted into email at booking time (Slice 3 consent_intent) → durable email consent.
  return sendAppointmentEmail(db, {
    sourceKey: 'appointment-confirmation',
    appt: data as unknown as ApptRow,
    actor: 'public',
    durableConsentGranted: true,
  })
}

/**
 * Send the cancellation notice (Slice 6). Best-effort — the cancellation is already
 * committed. Transactional (the attendee just cancelled), so email consent is durable.
 */
export async function sendCancellationNotice(appointmentId: string): Promise<NotifyOutcome> {
  const db = getDb()
  const { data } = await db.from('appointments').select(APPT_SELECT).eq('id', appointmentId).maybeSingle()
  if (!data) return { sent: false, reason: 'not_found' }
  return sendAppointmentEmail(db, {
    sourceKey: 'appointment-cancellation',
    appt: data as unknown as ApptRow,
    actor: 'public',
    durableConsentGranted: true,
  })
}

/** True iff a durable email booking-consent record exists for this contact (Slice 3). */
async function hasBookingEmailConsent(db: Db, contactId: string): Promise<boolean> {
  const { data } = await db
    .from('activities')
    .select('id')
    .eq('entity_type', 'contact')
    .eq('entity_id', contactId)
    .eq('kind', 'consent_intent')
    .limit(1)
    .maybeSingle()
  return !!data
}

export interface ReminderPassResult {
  scanned: number
  sent: number
  deferred: number
  skipped: number
}

/**
 * Sweep upcoming appointments and send the single pre-appointment reminder, idempotently.
 * `reminder_sent_at` is the atomic claim: only the tick that flips null→now sends, so
 * overlapping cron ticks never double-send. A blocked/deferred send (e.g. quiet hours) resets
 * the claim so a later tick retries; a no-consent contact is skipped without a send.
 */
export async function runBookingReminderPass(
  now: Date,
  opts: { leadHours?: number; limit?: number } = {},
): Promise<ReminderPassResult> {
  const db = getDb()
  const leadHours = opts.leadHours ?? reminderLeadHours()
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 1000)
  const nowIso = now.toISOString()
  const windowEndIso = new Date(now.getTime() + leadHours * 3_600_000).toISOString()

  const { data, error } = await db
    .from('appointments')
    .select(APPT_SELECT)
    .eq('status', 'scheduled')
    .is('reminder_sent_at', null)
    .gt('starts_at', nowIso)
    .lte('starts_at', windowEndIso)
    .order('starts_at', { ascending: true })
    .limit(limit)
  if (error) return { scanned: 0, sent: 0, deferred: 0, skipped: 0 }

  const rows = (data ?? []) as unknown as ApptRow[]
  const result: ReminderPassResult = { scanned: rows.length, sent: 0, deferred: 0, skipped: 0 }

  for (const appt of rows) {
    const candidate: ReminderCandidate = {
      status: appt.status,
      startsAt: appt.starts_at,
      bookedAt: appt.booked_at,
      reminderSentAt: appt.reminder_sent_at,
    }
    if (!isReminderDue(candidate, now, leadHours)) {
      result.skipped++
      continue
    }
    // Consent gate BEFORE claiming — a no-consent contact is skipped, not repeatedly retried.
    if (!appt.contact_id || !(await hasBookingEmailConsent(db, appt.contact_id))) {
      result.skipped++
      continue
    }
    // Atomic claim: only the tick that flips null→now proceeds.
    const claim = await db
      .from('appointments')
      .update({ reminder_sent_at: nowIso, updated_at: nowIso })
      .eq('id', appt.id)
      .is('reminder_sent_at', null)
      .select('id')
      .maybeSingle()
    if (claim.error || !claim.data) {
      result.skipped++ // lost the race to a concurrent tick
      continue
    }
    const outcome = await sendAppointmentEmail(db, {
      sourceKey: 'appointment-reminder-email',
      appt,
      actor: 'agent:booking-reminders',
      durableConsentGranted: true, // consent verified above
    })
    if (outcome.sent) {
      result.sent++
    } else {
      // Not sent (template not approved yet, quiet hours, transient block) → release the claim
      // so a later tick retries while the appointment is still upcoming.
      await db.from('appointments').update({ reminder_sent_at: null }).eq('id', appt.id)
      result.deferred++
    }
  }
  return result
}
