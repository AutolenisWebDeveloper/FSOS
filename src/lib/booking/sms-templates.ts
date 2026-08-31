// src/lib/booking/sms-templates.ts
// Booking lifecycle SMS templates — CONTENT AS CODE (P5 Stage 4). Plain-text bodies for the six
// appointment events, the SMS counterpart to the React email components (src/emails/appointments).
// A dev-time build step (scripts/build-sms-templates.ts) upserts these into comm_templates as
// DRAFT rows that the FSA approves before anything sends — the same immutable-approval store +
// gate step-4 check every FSOS SMS uses (mig 086 etc.), NOT a new store or an advisor-facing
// builder. This module is pure data (no imports) so it stays offline-testable.
//
// Compliance (twilio-a2p-compliance): every body carries STOP inline (the dispatcher does NOT
// append an SMS footer — the body is authoritative), leads with sender identity ({{agency_name}},
// a blocking token the send path auto-injects), and is transactional appointment content only —
// recap + no-show stay clean (thank-you / rebook, no product nudge/cross-sell/referral, else it
// becomes marketing needing separate consent). Final wording is reconciled to the approved Twilio
// A2P campaign templates before go-live.
//
// ENCODING: every body must stay GSM-7. A single non-GSM character (an em dash is the easy
// mistake — the reminder carried one) switches the whole message to UCS-2, which cuts the
// per-segment budget from 153 characters to 67 and turned a 3-segment reminder into 5. Use '-' or ':'
// rather than '—'. tests/booking-sms-templates.test.mjs pins both the encoding and the
// rendered segment count, measured with a real signed manage link.
//
// Merge tokens are the ALREADY-ENFORCED ones (personalize.ts is NOT modified): {{agency_name}}
// (identity, blocking), {{first_name}}, {{appointment_time}} (the appointment's grounded full
// local time — after a reschedule this IS the new time), {{reschedule_url}} (absolute + signed,
// blocking URL), {{scheduling_link}} (absolute, auto-injected). No {{manage_url}} (that was a
// draft-copy token; the enforced {{reschedule_url}}/{{scheduling_link}} carry the absolute-signed
// guarantee instead — mirrors the email reconciliation).

export interface BookingSmsTemplate {
  /** Stable source_key — MUST equal notify-events.ts sourceKeyFor(event, 'sms'). */
  sourceKey: string
  /** Human name shown in the approval console. */
  name: string
  /** comm_templates.category (matches the appointment email templates). */
  category: 'appointment'
  /** Plain-text SMS body (merge tokens substituted verbatim at send; STOP inline). */
  body: string
}

export const BOOKING_SMS_TEMPLATES: BookingSmsTemplate[] = [
  {
    sourceKey: 'appointment-confirmation-sms',
    name: 'Appointment confirmation (SMS)',
    category: 'appointment',
    body:
      "{{agency_name}}: You're confirmed for {{appointment_time}}. " +
      'Reschedule or cancel: {{reschedule_url}} Reply STOP to opt out, HELP for help.',
  },
  {
    sourceKey: 'appointment-reminder-sms',
    name: 'Appointment reminder (SMS)',
    category: 'appointment',
    body:
      '{{agency_name}}: Reminder - your appointment is {{appointment_time}}. ' +
      'Reschedule or cancel: {{reschedule_url}} Reply STOP to opt out.',
  },
  {
    sourceKey: 'appointment-rescheduled-sms',
    name: 'Appointment rescheduled (SMS)',
    category: 'appointment',
    body:
      '{{agency_name}}: Your appointment has been moved to {{appointment_time}}. ' +
      'Reschedule or cancel: {{reschedule_url}} Reply STOP to opt out.',
  },
  {
    sourceKey: 'appointment-cancellation-sms',
    name: 'Appointment cancellation (SMS)',
    category: 'appointment',
    body:
      '{{agency_name}}: Your appointment for {{appointment_time}} has been cancelled. ' +
      'Rebook anytime: {{scheduling_link}} Reply STOP to opt out.',
  },
  {
    sourceKey: 'appointment-noshow-sms',
    name: 'No-show follow-up (SMS)',
    category: 'appointment',
    body:
      '{{agency_name}}: Sorry we missed you for your appointment on {{appointment_time}}. ' +
      'Rebook anytime: {{scheduling_link}} Reply STOP to opt out.',
  },
  {
    sourceKey: 'appointment-recap-sms',
    name: 'Appointment recap / thank-you (SMS)',
    category: 'appointment',
    body:
      '{{agency_name}}: Thanks for meeting with us today, {{first_name}}. ' +
      'Questions? Just reply. Reply STOP to opt out.',
  },
]
