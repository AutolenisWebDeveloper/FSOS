// src/lib/booking/notify-core.ts
// PURE core for booking notifications (Slice 5) — DB-free and clock-injected, so the
// reminder-due rule, the merge-token context, and the meeting-details copy are unit-provable
// offline. The impure send path (notify.ts) renders these into sendMessage calls.

const MS_PER_HOUR = 3_600_000
export const DEFAULT_REMINDER_LEAD_HOURS = 24

export type MeetingMode = 'video' | 'phone' | 'in_person'

/** Human, timezone-correct appointment time, e.g. "Monday, August 3, 2026 at 9:00 AM CDT". */
export function formatAppointmentTime(startsAtIso: string, timeZone: string): string {
  const d = new Date(startsAtIso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(d)
  } catch {
    // Unknown zone → fall back to UTC rather than throwing in a send path.
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(d)
  }
}

export interface MeetingDetailsInput {
  meetingMode: string
  joinUrl?: string | null
  phone?: string | null
  location?: string | null
}

/**
 * The plain-text "how to attend" line carried in the confirmation/reminder. Plain text on
 * purpose: the comms personalizer HTML-escapes merge VALUES for email, so a URL here renders
 * as (auto-linkified) text and can never inject markup — while the plaintext part stays
 * verbatim. Never asserts a securities recommendation (green-zone copy).
 */
export function meetingDetailsText(inp: MeetingDetailsInput): string {
  if (inp.meetingMode === 'video') {
    return inp.joinUrl
      ? `Join your video meeting here: ${inp.joinUrl}`
      : 'Your video meeting link will be sent to you shortly.'
  }
  if (inp.meetingMode === 'phone') {
    return inp.phone
      ? `This is a phone meeting — we'll call you at ${inp.phone} at the scheduled time.`
      : "This is a phone meeting — we'll call you at the number you provided at the scheduled time."
  }
  return inp.location
    ? `We'll meet in person at ${inp.location}.`
    : 'This is an in-person meeting; location details will follow.'
}

/** The merge-token context passed to the gate as recipientContext for a booking email. */
export interface BookingMergeContext {
  first_name: string
  full_name: string
  appointment_time: string
  meeting_details: string
}

export function buildBookingContext(input: {
  fullName: string | null | undefined
  startsAt: string
  bookerTimezone: string | null | undefined
  meetingMode: string
  joinUrl?: string | null
  phone?: string | null
  location?: string | null
}): BookingMergeContext {
  const full = (input.fullName || '').trim() || 'there'
  const first = full.split(/\s+/)[0] || 'there'
  return {
    first_name: first,
    full_name: full,
    appointment_time: formatAppointmentTime(input.startsAt, input.bookerTimezone || 'America/Chicago'),
    meeting_details: meetingDetailsText({
      meetingMode: input.meetingMode,
      joinUrl: input.joinUrl,
      phone: input.phone,
      location: input.location,
    }),
  }
}

/** The transactional-fallback email content for a lifecycle event (B-3). PURE + fail-closed by
 *  construction: every branch returns a non-empty subject/heading/lede AND rows that always state
 *  WHAT (appointment) and WHEN (time) + HOW (meeting details), so a fallback can never ship empty. */
export interface BookingFallbackContent {
  subject: string
  heading: string
  lede: string
  rows: { label: string; value: string }[]
  note: string
}

export function buildBookingFallbackContent(
  event: string,
  inp: {
    agent: string
    typeName: string
    name: string
    appointmentTime: string
    meetingDetails: string
    rescheduleUrl?: string | null
    cancelUrl?: string | null
    scheduleUrl: string
  },
): BookingFallbackContent {
  const typeName = inp.typeName || 'your appointment'
  const name = inp.name || 'there'
  const changeNote = inp.rescheduleUrl
    ? `Need to make a change? Reschedule: ${inp.rescheduleUrl} — Cancel: ${inp.cancelUrl ?? inp.rescheduleUrl}`
    : "Need to make a change? Reply to this email and we'll take care of it."
  const rows = [
    { label: 'Appointment', value: typeName },
    { label: 'When', value: inp.appointmentTime },
    { label: 'How', value: inp.meetingDetails },
  ]
  let subject: string, heading: string, lede: string, note: string
  switch (event) {
    case 'rescheduled':
      subject = `Appointment rescheduled — ${typeName}`
      heading = `Your appointment has been rescheduled, ${name}.`
      lede = `Your appointment with ${inp.agent} has a new time. The updated details are below.`
      note = changeNote
      break
    case 'cancellation':
      subject = `Appointment cancelled — ${typeName}`
      heading = `Your appointment has been cancelled, ${name}.`
      lede = `Your appointment with ${inp.agent} has been cancelled. If this was a mistake or you'd like to rebook, we're happy to help.`
      note = `Rebook any time at ${inp.scheduleUrl}`
      break
    case 'reminder':
      subject = `Reminder — ${typeName}`
      heading = `A reminder about your upcoming appointment, ${name}.`
      lede = `This is a friendly reminder of your appointment with ${inp.agent}. The details are below.`
      note = changeNote
      break
    case 'no_show_followup':
      subject = `We missed you — ${typeName}`
      heading = `Sorry we missed you, ${name}.`
      lede = `It looks like we weren't able to connect for your appointment with ${inp.agent}. We'd love to find a time that works better for you.`
      note = `Rebook any time at ${inp.scheduleUrl}`
      break
    case 'recap':
      subject = `Thank you for meeting — ${typeName}`
      heading = `Thank you for your time, ${name}.`
      lede = `Thanks for meeting with ${inp.agent}. If any follow-up would help, just reply to this email.`
      note = ''
      break
    default:
      subject = `Appointment update — ${typeName}`
      heading = `An update about your appointment, ${name}.`
      lede = `Here are the latest details for your appointment with ${inp.agent}.`
      note = changeNote
  }
  return { subject, heading, lede, rows, note }
}

/** A row (subset) the reminder sweep reasons over. */
export interface ReminderCandidate {
  status: string
  startsAt: string | null
  bookedAt: string | null
  reminderSentAt: string | null
}

/**
 * True iff a single pre-appointment reminder is due now. A reminder fires once, within
 * `leadHours` before the start, only for a still-scheduled, not-yet-reminded appointment —
 * and NOT when the booking was made inside the lead window (a same-window booking already
 * got its confirmation, so a near-immediate "reminder" would be redundant).
 */
export function isReminderDue(c: ReminderCandidate, now: Date, leadHours = DEFAULT_REMINDER_LEAD_HOURS): boolean {
  if (c.status !== 'scheduled') return false
  if (c.reminderSentAt) return false
  if (!c.startsAt) return false
  const start = Date.parse(c.startsAt)
  const nowMs = now.getTime()
  if (!Number.isFinite(start)) return false
  if (start <= nowMs) return false // already started / past
  const windowOpen = start - leadHours * MS_PER_HOUR
  if (nowMs < windowOpen) return false // too early to remind
  // Skip if the booking itself happened inside the lead window (confirmation suffices).
  if (c.bookedAt) {
    const booked = Date.parse(c.bookedAt)
    if (Number.isFinite(booked) && booked >= windowOpen) return false
  }
  return true
}
