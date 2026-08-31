// src/lib/booking/notify.ts
// Booking notifications — every appointment lifecycle notice (confirmation, reminder,
// reschedule, cancellation, recap, no-show follow-up) on both channels, routed through the
// EXISTING comms platform via sendMessage. Comms code is consumed, never modified: the gate
// (consent, quiet-hours, DNC, approved-template, personalization, recommendation, securities)
// is re-checked at send time exactly as for any other send.
//
// The two channels reach consent by different routes, and the difference is deliberate:
//   • EMAIL rides the durable booking-email consent as `durableConsentGranted` (the workshop
//     non-member pattern) — a booking through our own funnel IS an opt-in to mail about it;
//   • SMS waives NOTHING. It requires the separate affirmative opt-in the booking form
//     captures (src/lib/booking/sms-consent.ts), which the gate resolves for itself from the
//     consent stores. Passing a waiver on SMS would bypass TCPA prior-express-written consent,
//     so `durableConsentGranted` is forced false on every SMS leg in this file.
//
// Bodies are the STORED, approved templates (ADR-025 for email; migration 135 seeds the six
// approved SMS bodies authored in sms-templates.ts). The specific time, join link and signed
// manage links are merge tokens grounded at send time, never baked in.

import { getDb } from '@/lib/supabase/client'
import { unwrapOne } from '@/lib/data/query'
import { BUSINESS, CONTACT, siteUrl } from '@/lib/site'
import { sendMessage } from '@/lib/comms/send'
import { sendVisitorAck } from '@/lib/notifications/transactional'
import { signManageToken, manageTokenKey, MANAGE_TOKEN_TTL_MS } from './manage-tokens'
import { buildBookingContext, buildBookingFallbackContent } from './notify-core'
import { loadReminderConfig, reminderLeadHours } from './notification-config'
import { type LifecycleEvent, sourceKeyFor, dueReminderOffsets } from './notify-events'
import { smsA2pApproved } from '@/lib/comms/a2p'
import { isDeferralGateStep } from '@/lib/comms/gate'
import type { MessagePurpose } from '@/lib/comms/purpose'

// Re-exported so existing callers keep importing the reminder lead from the notify module.
export { reminderLeadHours }

const OFFICE_LOCATION = `${CONTACT.address.line1}, ${CONTACT.address.city}, ${CONTACT.address.region} ${CONTACT.address.postal}`

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
  booked_via: string | null
  updated_at: string | null
  status: string
  schedule_version: number | null
  reminder_sent_at: string | null
  cancel_token: string | null
  reschedule_token: string | null
  contacts: ContactRow | ContactRow[] | null
  appointment_types: TypeRow | TypeRow[] | null
}

const APPT_SELECT =
  'id, contact_id, starts_at, booker_timezone, meeting_mode, join_url, booked_at, booked_via, updated_at, ' +
  'status, schedule_version, reminder_sent_at, cancel_token, reschedule_token, ' +
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

export type NotifyOutcome = {
  sent: boolean
  reason?: string
  blockedStep?: string
  /** False only when the GATE withheld the send; true when it cleared and the provider failed. */
  gateAllowed?: boolean
  messageId?: string
}

/** Send one appointment message on a channel (email or SMS) through the gate. */
async function sendAppointmentMessage(
  db: Db,
  opts: { channel: 'email' | 'sms'; sourceKey: string; appt: ApptRow; actor: string; durableConsentGranted: boolean },
): Promise<NotifyOutcome> {
  const contact = unwrapOne(opts.appt.contacts)
  const type = unwrapOne(opts.appt.appointment_types)
  if (!opts.appt.starts_at) return { sent: false, reason: 'no_start' }
  const to = opts.channel === 'email' ? contact?.email : contact?.phone
  if (!to) return { sent: false, reason: opts.channel === 'email' ? 'no_email' : 'no_phone' }

  // Deferred if the template isn't approved yet (mirrors the workshop template-not-approved
  // deferral) — the appointment already succeeded; the notice simply waits for approval.
  const tpl = await loadApprovedTemplate(db, opts.sourceKey)
  if (!tpl) return { sent: false, reason: 'template_not_approved' }

  const ctx = buildBookingContext({
    fullName: contact?.full_name,
    startsAt: opts.appt.starts_at,
    bookerTimezone: opts.appt.booker_timezone,
    meetingMode: opts.appt.meeting_mode ?? type?.meeting_mode ?? 'video',
    joinUrl: opts.appt.join_url,
    phone: contact?.phone,
    location: OFFICE_LOCATION,
  })

  const outcome = await sendMessage({
    channel: opts.channel,
    to,
    // Classify BOTH legs. APPOINTMENT is what these messages are — transactional appointment
    // content with no promotional ask — and every purpose-keyed control then does the right
    // thing on its own instead of being special-cased:
    //   • quiet hours: purpose.ts scopes the 9:00-20:00 floor to SMS MARKETING traffic, and an
    //     UNCLASSIFIED SMS defaults INTO it — so without this an evening booking's confirmation
    //     was blocked, and an immediate notice has no cron behind it to try again;
    //   • frequency: routes both legs to the 'appointment' cap row (mig 136/137). While the
    //     email leg was unclassified it counted against the OUTREACH row's 3-touches-a-day
    //     ceiling, which the 24h+12h+1h cadence overruns — the 1-hour reminder email, the one
    //     that matters most, was refused for anyone who resolves to a household member.
    // The one thing purpose would ALSO decide — the email sending identity — is pinned below
    // instead, so classifying changes no delivered email.
    //
    // It relaxes nothing: consent (the durable booking grant still ORs in), DNC/STOP, approval,
    // personalization, the recommendation red line and the securities firewall all still run,
    // and `suppressible: false` below already short-circuits business suppression either way.
    // The branded email shell is purpose-independent and passes a full HTML document through
    // untouched, so the delivered appointment email is byte-identical.
    purpose: APPOINTMENT_PURPOSE,
    // …with ONE thing the purpose does NOT get to decide: the email sending identity.
    // senders.ts would route a non-marketing purpose to the transactional stream; the owner
    // has chosen to keep appointment email on the marketing stream, so it is pinned here
    // rather than left to fall out of the classification. Ignored for SMS. This is the whole
    // visible difference purpose makes to an email — with it pinned, the delivered appointment
    // email is identical to what it was before the classification, headers included.
    emailStream: 'marketing',
    subject: opts.channel === 'email' ? tpl.subject ?? undefined : undefined,
    body: tpl.body,
    bodyText: opts.channel === 'email' ? tpl.body_text ?? undefined : undefined,
    templateId: tpl.id,
    // EMAIL rides the durable booking-email consent (non-member transactional basis). SMS must
    // NEVER waive: it requires the SEPARATE AFFIRMATIVE opt-in, which the gate resolves from
    // comm_contact_consents by the recipient phone (Stage 3). Passing a waiver on SMS would
    // bypass TCPA prior-express-written consent — so it is forced false for SMS.
    durableConsentGranted: opts.channel === 'email' ? opts.durableConsentGranted : false,
    isSecurity: false,
    // Appointment reminders/confirmations are TRANSACTIONAL: never excluded by agent-level or
    // individual business communication suppression (they carry no marketing purpose, so this
    // declares them non-suppressible explicitly — without altering their quiet-hours handling).
    suppressible: false,
    // …and, for the same reason, not held by the operator's HOURS OF OPERATION window. That
    // window (comm_hours_policy, seeded 09:00-19:00 Mon-Sat) governs outreach; an appointment
    // notice is the receipt of something the client just did. Without this, booking on a Sunday
    // evening — an ordinary thing to do with a self-service scheduler — held the confirmation
    // until Monday morning while the booking screen said a text was on its way. The statutory
    // quiet-hours floor is a SEPARATE step and is untouched, as are consent, DNC, approval, the
    // recommendation red line and the securities firewall.
    businessHoursExempt: true,
    actor: opts.actor,
    entity: { type: 'appointment', id: opts.appt.id },
    // Merge context + signed reschedule/cancel manage links (unused tokens render empty).
    recipientContext: { ...ctx, ...manageUrls(opts.appt) },
  })
  return {
    sent: outcome.sent,
    reason: outcome.sent ? undefined : outcome.reason ?? 'gate_blocked',
    // The gate step that withheld the send. deliverLeg keys the retry-vs-terminal decision off
    // it via the gate's OWN DEFERRAL_GATE_STEPS set, so this path cannot classify a hold as
    // terminal (or a terminal verdict as retryable) differently from the campaign ticks.
    blockedStep: outcome.sent ? undefined : outcome.gate?.blockedStep,
    // The dispatcher reports gate.allowed=true with sent=false when the gate CLEARED and the
    // provider (Twilio/Resend) then failed. That is a transport failure, not a verdict.
    gateAllowed: outcome.gate?.allowed !== false,
    messageId: outcome.messageId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P5 delivery ledger (mig 093 + 135) — the fire-once correctness core. One row per notice
// actually acted on, keyed UNIQUE(appointment_id, schedule_version, event, offset_minutes,
// channel). The claim is an atomic INSERT … ON CONFLICT DO NOTHING (upsert + ignoreDuplicates):
// a returned row = we won the claim and must send; no row = the leg is already settled → skip.
// schedule_version (bumped by the reschedule mover) ties each delivery to a specific scheduled
// instant, so a reschedule re-arms every leg once.
//
// A leg that does NOT send settles one of two ways, and the difference is the whole reason the
// SMS legs do not churn:
//   • a self-clearing HOLD (A2P not live yet, frequency day, template still a draft) DELETES the
//     claim, so the next tick re-claims and retries — the legacy null→now→release behavior;
//   • a TERMINAL verdict (no consent, DNC, no phone) KEEPS the row as status='blocked' with its
//     reason, so the leg is fire-once in both directions. Without this, an appointment whose
//     booker never opted into SMS re-ran the whole gate and wrote a fresh blocked comm_messages
//     row on every 15-minute tick from T-24h to the meeting. A reschedule still re-arms it (new
//     schedule_version ⇒ new key), which is the intended way a corrected record gets another try.
// ─────────────────────────────────────────────────────────────────────────────

const DELIVERY_CONFLICT = 'appointment_id,schedule_version,event,offset_minutes,channel'

type ClaimResult = { id: string } | { skip: 'settled' | 'error' }

/**
 * Atomically claim a delivery leg. Returns the new row id, or why it was not claimed. The claim
 * lands as 'deferred' and is promoted to 'sent'/'blocked' by the outcome — so a row still
 * reading 'deferred' is a leg that died mid-send, which is visible rather than silently "sent".
 */
async function claimDelivery(
  db: Db,
  c: { appointmentId: string; scheduleVersion: number; event: LifecycleEvent; offsetMinutes: number; channel: 'email' | 'sms' },
): Promise<ClaimResult> {
  const { data, error } = await db
    .from('booking_notification_deliveries')
    .upsert(
      {
        appointment_id: c.appointmentId,
        schedule_version: c.scheduleVersion,
        event: c.event,
        offset_minutes: c.offsetMinutes,
        channel: c.channel,
        status: 'deferred',
      },
      { onConflict: DELIVERY_CONFLICT, ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()
  if (error) return { skip: 'error' }
  if (!data) return { skip: 'settled' } // ON CONFLICT DO NOTHING returned no row → already settled
  return { id: data.id as string }
}

/** Persist the successful send's comm_messages link on the claimed ledger row. */
async function markDeliverySent(db: Db, id: string, messageId?: string): Promise<void> {
  await db
    .from('booking_notification_deliveries')
    .update({ status: 'sent', comm_message_id: messageId ?? null })
    .eq('id', id)
}

/** Settle a claim as TERMINALLY withheld, with the reason — the leg is not retried. */
async function markDeliveryBlocked(db: Db, id: string, reason: string): Promise<void> {
  await db
    .from('booking_notification_deliveries')
    .update({ status: 'blocked', block_reason: reason.slice(0, 200) })
    .eq('id', id)
}

/** Release a claim (self-clearing hold) so a later tick can re-claim and retry. */
async function releaseDelivery(db: Db, id: string): Promise<void> {
  await db.from('booking_notification_deliveries').delete().eq('id', id)
}

/**
 * Pre-gate reasons (returned before sendMessage runs, so they carry no gate step) that clear on
 * their own and MUST stay retryable — today just the one: an unapproved template becomes
 * approved. Everything else without a deferral gate step is terminal for this schedule_version:
 * `no_phone`/`no_email`/`no_start` need a record correction, and a corrected record reaches the
 * notice through the reschedule bump.
 */
const RETRYABLE_PRE_GATE_REASONS: ReadonlySet<string> = new Set(['template_not_approved'])

/**
 * Pre-gate reasons that will NOT clear on their own: the appointment or contact record has to
 * change first, and a corrected record reaches the notice through the reschedule bump. Anything
 * outside both sets that never reached a gate verdict is treated as a transport failure and
 * retried — the safe default, since losing a confirmation is worse than attempting it twice
 * (the ledger claim already makes a genuine duplicate impossible).
 */
const PRE_GATE_TERMINAL_REASONS: ReadonlySet<string> = new Set(['no_phone', 'no_email', 'no_start', 'not_found'])

/**
 * Blocked steps that are self-clearing HOLDS but are NOT in the gate's shared DEFERRAL set.
 * `not_configured` (messaging.ts: Twilio/Resend env missing) clears the moment an operator sets
 * the credential — exactly like `sms_live` — and it is escalate:false, so treating it as a
 * verdict would silently and permanently write off every appointment SMS placed during a
 * misconfigured window: precisely the window a go-live runs through. Kept local rather than
 * added to DEFERRAL_GATE_STEPS, which is shared with the campaign engines whose retry semantics
 * are not this change's to alter.
 */
const RETRYABLE_EXTRA_GATE_STEPS: ReadonlySet<string> = new Set(['not_configured'])

/**
 * True when a withheld leg should be released for a later tick rather than settled as blocked.
 *
 * Three cases, in order:
 *   • the GATE cleared and the send still failed ⇒ the provider errored (a Twilio 5xx, a network
 *     blip). Always retryable — treating it as terminal would throw away the confirmation on a
 *     transient outage, which is exactly the failure the retry pass exists to survive;
 *   • the gate blocked on a self-clearing step ⇒ retryable, per the gate's OWN classification
 *     (plus the local `not_configured` hold below, which that shared set does not cover);
 *   • anything else ⇒ terminal for this schedule_version (a real verdict, or a pre-gate reason
 *     that needs a record correction).
 */
function isRetryableOutcome(outcome: NotifyOutcome): boolean {
  if (outcome.gateAllowed !== false) {
    // No gate verdict: either the provider failed, or we never reached the gate (pre-gate reason).
    if (outcome.reason && RETRYABLE_PRE_GATE_REASONS.has(outcome.reason)) return true
    return !PRE_GATE_TERMINAL_REASONS.has(outcome.reason ?? '')
  }
  return isDeferralGateStep(outcome.blockedStep) || RETRYABLE_EXTRA_GATE_STEPS.has(outcome.blockedStep ?? '')
}

/**
 * B-3 — the guaranteed TRANSACTIONAL fallback for a lifecycle notice whose approved template is not
 * yet available (templates seed as `draft`). Built entirely from the appointment's own data, so the
 * message is NEVER empty (fail-closed by construction: it always states WHAT and WHEN) and a
 * reschedule / cancellation / reminder is never silently dropped while templates await approval —
 * the same guarantee book.ts already gives the INITIAL confirmation. Email only: SMS has no
 * transactional carve-out (A2P/TCPA), so an SMS leg still defers rather than falling back.
 */
async function sendBookingTransactionalFallback(
  db: Db,
  appt: ApptRow,
  event: LifecycleEvent,
): Promise<NotifyOutcome> {
  const contact = unwrapOne(appt.contacts)
  const type = unwrapOne(appt.appointment_types)
  const to = contact?.email
  if (!to || !appt.starts_at) return { sent: false, reason: 'no_recipient' }
  const ctx = buildBookingContext({
    fullName: contact?.full_name,
    startsAt: appt.starts_at,
    bookerTimezone: appt.booker_timezone,
    meetingMode: appt.meeting_mode ?? type?.meeting_mode ?? 'video',
    joinUrl: appt.join_url,
    phone: contact?.phone,
    location: OFFICE_LOCATION,
  })
  const links = manageUrls(appt)
  const { subject, heading, lede, rows, note } = buildBookingFallbackContent(event, {
    agent: BUSINESS.agent,
    typeName: type?.name || 'your appointment',
    name: ctx.first_name,
    appointmentTime: ctx.appointment_time,
    meetingDetails: ctx.meeting_details,
    rescheduleUrl: links.reschedule_url,
    cancelUrl: links.cancel_url,
    scheduleUrl: `${siteUrl()}/schedule`,
  })
  const result = await sendVisitorAck({
    to, subject, heading, lede, rows, note: note || undefined,
    // The attendee booked this appointment; the lifecycle notice is its transactional
    // consequence. This fallback is now GATED like every other send — it previously
    // reached Resend with no consent, DNC or suppression check because
    // sendAppointmentMessage returns `template_not_approved` BEFORE the gate ran.
    transactionalBasis: true,
    entity: { type: 'appointment', id: appt.id },
  })
  return { sent: result.ok === true, reason: result.ok ? undefined : result.error ?? 'fallback_failed', messageId: result.id }
}

/**
 * Deliver ONE leg (email or SMS) for a lifecycle event through the ledger: claim → send → settle.
 * Fire-once is the UNIQUE-key claim; the settle decides whether the leg stays claimable (a
 * self-clearing hold or a provider failure releases it) or is finished for this schedule_version
 * (a terminal verdict is recorded with its reason). The gate is unchanged — consent, quiet-hours,
 * DNC, approved-template, recommendation, and the securities firewall all re-check at send time.
 * The SMS leg additionally holds until A2P
 * 10DLC is live (SMS_A2P_APPROVED) — checked BEFORE claiming so a later tick claims once it is,
 * and the gate's own smsLive step is the backstop.
 */
async function deliverLeg(
  db: Db,
  appt: ApptRow,
  args: { event: LifecycleEvent; offsetMinutes: number; channel: 'email' | 'sms'; actor: string; durableConsentGranted: boolean },
): Promise<NotifyOutcome> {
  // A2P 10DLC hold: never claim an SMS leg while SMS is not yet live — leave it unclaimed so a
  // later tick delivers it once A2P is approved (mirrors the campaign tick's sms_a2p_hold).
  if (args.channel === 'sms' && !smsA2pApproved()) {
    return { sent: false, reason: 'sms_a2p_hold' }
  }
  // No number, nothing to claim. Checked BEFORE the claim (the same check inside
  // sendAppointmentMessage runs after it) so an appointment whose contact has no phone does not
  // burn a ledger row and run the whole gate — including its blocked-send escalation — to
  // rediscover a fact already on the row in hand, on every configured offset.
  if (args.channel === 'sms' && !unwrapOne(appt.contacts)?.phone) {
    return { sent: false, reason: 'no_phone' }
  }
  const scheduleVersion = appt.schedule_version ?? 1
  const claim = await claimDelivery(db, {
    appointmentId: appt.id,
    scheduleVersion,
    event: args.event,
    offsetMinutes: args.offsetMinutes,
    channel: args.channel,
  })
  if ('skip' in claim) {
    return { sent: false, reason: claim.skip === 'settled' ? 'already_delivered' : 'ledger_error' }
  }
  // Everything from here to the settle MUST be inside the try: a throw between claiming and
  // settling (an unconfigured manage-token signing key, a provider client that rejects, a DB
  // blip) would leave the claim behind as an unsettled row, and the UNIQUE key would then make
  // the leg unclaimable forever — the notice silently lost for the life of this schedule
  // version. On a throw the claim is RELEASED so the next tick re-attempts it.
  let outcome: NotifyOutcome
  try {
    outcome = await sendAppointmentMessage(db, {
      channel: args.channel,
      sourceKey: sourceKeyFor(args.event, args.channel),
      appt,
      actor: args.actor,
      durableConsentGranted: args.durableConsentGranted,
    })
  } catch (err) {
    await releaseDelivery(db, claim.id)
    console.error('[booking] notice leg threw — claim released for retry', {
      appointment: appt.id,
      event: args.event,
      channel: args.channel,
      error: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, reason: 'send_threw' }
  }
  if (outcome.sent) {
    await markDeliverySent(db, claim.id, outcome.messageId)
    return outcome
  }
  // B-3 — the approved template isn't available yet (they seed as `draft`). For EMAIL, fall back to
  // a guaranteed transactional notice built from the appointment's own data, so a reschedule /
  // cancellation / reminder / recap / no-show-follow-up is NEVER silently dropped while templates
  // await approval. ONLY the template-availability reason falls back; a genuine consent / DNC /
  // quiet-hours / no-recipient hold must still defer (release the claim to retry). 'confirmation' is
  // excluded — book.ts owns its fallback, so falling back here too would double-send the first booking.
  if (args.channel === 'email' && args.event !== 'confirmation' && outcome.reason === 'template_not_approved') {
    const fb = await sendBookingTransactionalFallback(db, appt, args.event)
    if (fb.sent) {
      await markDeliverySent(db, claim.id, fb.messageId)
      return fb
    }
  }
  // Not sent. Settle the claim by KIND, not by "it didn't send": a self-clearing hold releases
  // the claim so a later tick retries it, a terminal verdict (no consent, DNC, no phone) is
  // recorded on the ledger with its reason and never re-attempted for this schedule_version.
  if (isRetryableOutcome(outcome)) {
    await releaseDelivery(db, claim.id)
  } else {
    await markDeliveryBlocked(db, claim.id, outcome.blockedStep ?? outcome.reason ?? 'gate_blocked')
  }
  return outcome
}

/** Immediate lifecycle events (everything except the per-offset reminder) fire at offset 0. */
const IMMEDIATE = 0

/** Gate purpose for appointment SMS — transactional appointment content (see sendAppointmentMessage). */
const APPOINTMENT_PURPOSE: MessagePurpose = 'APPOINTMENT'

/**
 * The single lifecycle-notice entry point (P5). Classifies the event to its approved stored
 * template and delivers the email leg through the fire-once ledger. Email-only in Stage 2; the
 * SMS leg is gated OFF by booking_reminder_config.sms_enabled until Stage 4 (consent verified).
 * Best-effort — the appointment change already committed, so a deferred/blocked notice never
 * fails the caller. `reminder` is handled by runBookingReminderPass (per-offset), not here.
 */
export async function sendAppointmentNotice(
  appointmentId: string,
  event: Exclude<LifecycleEvent, 'reminder'>,
  opts: { actor?: string } = {},
): Promise<NotifyOutcome> {
  const db = getDb()
  const { data } = await db.from('appointments').select(APPT_SELECT).eq('id', appointmentId).maybeSingle()
  if (!data) return { sent: false, reason: 'not_found' }
  const appt = data as unknown as ApptRow
  const actor = opts.actor ?? 'public'
  // Every immediate lifecycle notice is transactional (appointment-consent basis): the attendee
  // just booked / rescheduled / cancelled, or the advisor marked the outcome. Recap and no-show
  // stay transactional (thank-you / rebook only, no promo) so they ride the same durable email
  // consent — the moment either carries a product nudge it needs separate marketing consent.
  const emailOutcome = await deliverLeg(db, appt, {
    event,
    offsetMinutes: IMMEDIATE,
    channel: 'email',
    actor,
    durableConsentGranted: true,
  })
  // SMS leg (Stage 4) — only when the booking SMS feature flag is on. The affirmative SMS consent
  // (Stage 3, resolved by the gate from comm_contact_consents), A2P go-live, quiet hours, DNC, and
  // approved-template checks EACH still independently gate the actual send. Best-effort alongside
  // email; the EMAIL outcome stays the caller's headline result (book.ts keys its transactional
  // fallback off it, and a reschedule/cancel/send caller only reads whether the notice went out).
  const config = await loadReminderConfig(db)
  if (config.smsEnabled) {
    await deliverLeg(db, appt, { event, offsetMinutes: IMMEDIATE, channel: 'sms', actor, durableConsentGranted: false })
  }
  return emailOutcome
}

/**
 * Send the booking confirmation. Thin wrapper over the lifecycle classifier (a reschedule is a
 * `rescheduled` event, never a fresh confirmation — see the manage mover). `actor` attributes an
 * FSA-initiated re-send to the advisor (defaults to 'public' for the auto/public path).
 */
export async function sendBookingConfirmation(appointmentId: string, actor = 'public'): Promise<NotifyOutcome> {
  return sendAppointmentNotice(appointmentId, 'confirmation', { actor })
}

/** Send the cancellation notice. Thin wrapper over the lifecycle classifier. */
export async function sendCancellationNotice(appointmentId: string): Promise<NotifyOutcome> {
  return sendAppointmentNotice(appointmentId, 'cancellation', { actor: 'public' })
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
 * Sweep upcoming appointments and send each configured pre-appointment reminder offset on each
 * ENABLED channel, idempotently, through the P5 delivery ledger. The ledger's
 * UNIQUE(appointment, schedule_version, event, offset, channel) claim is the fire-once guarantee
 * (replacing the single `reminder_sent_at` boolean): overlapping cron ticks send each offset at
 * most once, and a reschedule (which bumps schedule_version) re-arms the new time's offsets
 * exactly once each. A self-clearing hold releases its claim so a later tick retries; a terminal
 * verdict settles on the ledger and is not re-attempted.
 *
 * The two channels are INDEPENDENT. They used to be entangled twice over, and both entanglements
 * silently disabled SMS reminders:
 *   • the pass returned early unless EMAIL reminders were enabled, so turning email reminders off
 *     took SMS reminders down with them;
 *   • the per-appointment gate was `hasBookingEmailConsent`, and a contact without that email
 *     consent-intent activity row `continue`d the whole appointment — so an attendee who ticked
 *     the SMS box but whose email consent row was missing (an appointment created by the FSA, or
 *     a best-effort activity insert that failed) got no text either.
 * Now each channel is enabled, gated and counted on its own. Email keeps its durable
 * booking-consent basis; SMS carries NO waiver at all — its affirmative opt-in is resolved by the
 * gate itself from the consent stores, exactly as for any other SMS.
 */
export async function runBookingReminderPass(
  now: Date,
  opts: { limit?: number } = {},
): Promise<ReminderPassResult> {
  const db = getDb()
  const result: ReminderPassResult = { scanned: 0, sent: 0, deferred: 0, skipped: 0 }

  const config = await loadReminderConfig(db)
  // Nothing to do only when BOTH reminder channels are off (or no offset is configured).
  if ((!config.emailEnabled && !config.smsEnabled) || config.offsets.length === 0) return result

  const limit = Math.min(Math.max(1, opts.limit ?? 200), 1000)
  const nowIso = now.toISOString()
  const maxOffsetMin = Math.max(...config.offsets)
  const windowEndIso = new Date(now.getTime() + maxOffsetMin * 60_000).toISOString()

  // Scan every scheduled appointment whose start falls inside the WIDEST offset window; the
  // per-appointment/per-offset due decision (and the ledger fire-once claim) narrows from there.
  const { data, error } = await db
    .from('appointments')
    .select(APPT_SELECT)
    .eq('status', 'scheduled')
    .gt('starts_at', nowIso)
    .lte('starts_at', windowEndIso)
    .order('starts_at', { ascending: true })
    .limit(limit)
  if (error) return result

  const rows = (data ?? []) as unknown as ApptRow[]
  result.scanned = rows.length

  for (const appt of rows) {
    // The suppression anchor is "when did the notice that already covered this moment go out".
    // For an original booking that is booked_at. After a RESCHEDULE it is the move itself: the
    // bumped schedule_version re-arms every offset, and an offset whose window opened days ago
    // would otherwise fire the instant the version changes — texting "Reminder - your appointment
    // is 4pm" seconds after "Your appointment has been moved to 4pm".
    const rescheduled = (appt.schedule_version ?? 1) > 1
    const anchor = rescheduled ? (appt.updated_at ?? appt.booked_at) : appt.booked_at
    const due = dueReminderOffsets(
      { status: appt.status, startsAt: appt.starts_at, bookedAt: anchor },
      config.offsets,
      now,
    )
    if (due.length === 0) {
      result.skipped++
      continue
    }
    // EMAIL eligibility only — the durable booking-email consent this pass asserts as the
    // waiver basis. It gates the EMAIL leg alone; SMS is never withheld on an email record.
    const emailEligible =
      config.emailEnabled && !!appt.contact_id && (await hasBookingEmailConsent(db, appt.contact_id))
    if (!emailEligible && !config.smsEnabled) {
      result.skipped++
      continue
    }
    for (const offset of due) {
      if (emailEligible) {
        const emailOutcome = await deliverLeg(db, appt, {
          event: 'reminder',
          offsetMinutes: offset,
          channel: 'email',
          actor: 'agent:booking-reminders',
          durableConsentGranted: true, // email booking consent verified above
        })
        if (emailOutcome.sent) result.sent++
        else if (emailOutcome.reason === 'already_delivered') result.skipped++
        else result.deferred++ // template not approved / transient hold — claim released
      }
      // SMS reminder leg — independent of the email leg in every way. The affirmative SMS
      // opt-in, A2P go-live, DNC/STOP, quiet-hours scope and template approval are each
      // enforced by the gate itself; nothing here waives any of them.
      if (config.smsEnabled) {
        const smsOutcome = await deliverLeg(db, appt, {
          event: 'reminder',
          offsetMinutes: offset,
          channel: 'sms',
          actor: 'agent:booking-reminders',
          durableConsentGranted: false,
        })
        if (smsOutcome.sent) result.sent++
        else if (smsOutcome.reason === 'already_delivered') result.skipped++
        else result.deferred++ // a2p hold / no SMS consent / not approved
      }
    }
  }
  return result
}

/** How far back a missed lifecycle SMS is re-driven. Older than this ⇒ left alone. */
const NOTICE_RETRY_WINDOW_MINUTES = 6 * 60

/**
 * How long a claim may sit unsettled before it is treated as abandoned. Far beyond any single
 * cron invocation (the route caps at 60s), so a leg that is genuinely mid-send is never reaped.
 */
const STALE_CLAIM_MINUTES = 15

/**
 * Release claims left UNSETTLED by a tick that died mid-send — a function timeout, an instance
 * recycled, a process killed between the claim and the settle.
 *
 * The claim is deliberately written as 'deferred' and promoted to 'sent'/'blocked' by the
 * outcome, so a row still reading 'deferred' long afterwards is exactly that: a leg nobody
 * finished. Without this it is the one way a notice can be lost permanently and silently — the
 * UNIQUE key makes the leg unclaimable for the life of its schedule_version, so no later tick
 * can ever retry it. Deleting the abandoned claim puts the leg back in play; if the send had in
 * fact reached the provider, the duplicate risk is bounded by that same one-in-a-crash window,
 * which is the right trade against losing the message outright.
 *
 * Returns how many were released, so a rising count is visible in the cron response.
 */
async function reapStaleClaims(db: Db, now: Date): Promise<number> {
  try {
    const cutoff = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000).toISOString()
    const { data } = await db
      .from('booking_notification_deliveries')
      .delete()
      .eq('status', 'deferred')
      .lt('created_at', cutoff)
      .select('id')
    const released = Array.isArray(data) ? data.length : 0
    if (released > 0) {
      console.error('[booking] released abandoned delivery claims (a tick died mid-send)', { released })
    }
    return released
  } catch {
    return 0
  }
}

export interface NoticeRetryResult {
  scanned: number
  sent: number
  deferred: number
  skipped: number
  /** Abandoned claims released back into play (a previous tick died mid-send). */
  reaped: number
}

/**
 * The lifecycle notice an appointment's CURRENT state says it is owed. Pure, so the mapping is
 * provable offline. Returns null when the row implies no client-facing notice.
 *
 * Every case is inferable from the row itself, which is what makes a retry possible at all: the
 * released ledger claim records nothing, so the pass has to re-derive what was owed.
 *   • still scheduled, version 1  → the original confirmation (public bookings only: an
 *     appointment the FSA typed in never had one, and this pass retries misses, not new sends);
 *   • still scheduled, version >1 → the reschedule notice for the current time;
 *   • cancelled / completed / no-show → the notice setAppointmentStatus already emits, so a
 *     retry is the same message the system chose to send, not a new one.
 * A meeting that has already started is past the point of a confirmation or reschedule notice.
 */
export function owedImmediateNotice(
  appt: { status: string; scheduleVersion: number; bookedVia: string | null; startsAt: string | null },
  now: Date,
): Exclude<LifecycleEvent, 'reminder'> | null {
  if (appt.status === 'cancelled') return 'cancellation'
  if (appt.status === 'completed') return 'recap'
  if (appt.status === 'no_show') return 'no_show_followup'
  if (appt.status !== 'scheduled') return null
  const start = appt.startsAt ? Date.parse(appt.startsAt) : NaN
  if (!Number.isFinite(start) || start <= now.getTime()) return null
  if (appt.scheduleVersion > 1) return 'rescheduled'
  return appt.bookedVia === 'native' ? 'confirmation' : null
}

/**
 * Re-drive appointment lifecycle SMS legs that did not go out when the change happened.
 *
 * Every IMMEDIATE notice — confirmation, reschedule, cancellation, recap, no-show — is fired
 * inline by whatever changed the appointment, and nothing re-invokes it. Email survives that by
 * construction (book.ts and deliverLeg both fall back to a transactional message), but an SMS leg
 * has no fallback at all: a Twilio hiccup, an A2P flag flipped on minutes later, or a template
 * approved just after go-live simply lost the text. This gives those legs the same durable,
 * ledger-idempotent retry the reminder offsets already have, bounded to recent changes so it can
 * never resurrect a stale notice.
 *
 * SMS only, and it adds no new send path: it calls the same deliverLeg, so the ledger's
 * fire-once claim means a notice that DID send is never re-sent, a terminal verdict (no consent,
 * DNC) settles once and is never re-attempted, and only a self-clearing hold or a transport
 * failure is retried. Runs alongside the reminder pass on the same cron.
 */
export async function runBookingNoticeRetryPass(
  now: Date,
  opts: { limit?: number } = {},
): Promise<NoticeRetryResult> {
  const db = getDb()
  const result: NoticeRetryResult = { scanned: 0, sent: 0, deferred: 0, skipped: 0, reaped: 0 }

  // Runs FIRST and regardless of the SMS flag: an abandoned claim blocks its leg on BOTH
  // channels, and the ledger is shared, so reaping is not conditional on this pass's own work.
  result.reaped = await reapStaleClaims(db, now)

  const config = await loadReminderConfig(db)
  if (!config.smsEnabled) return result

  const limit = Math.min(Math.max(1, opts.limit ?? 200), 1000)
  const changedAfterIso = new Date(now.getTime() - NOTICE_RETRY_WINDOW_MINUTES * 60_000).toISOString()

  // One recency-bounded scan; owedImmediateNotice narrows it per row. `updated_at` moves on the
  // insert and on every lifecycle change, so it covers all five events with a single query.
  // NEWEST first: a notice's value decays, so if the limit ever bites, the change that just
  // happened must be the one that gets through — an already-settled leg costs only its no-op
  // claim, and an older one still has the rest of the window to be picked up.
  const { data, error } = await db
    .from('appointments')
    .select(APPT_SELECT)
    .gte('updated_at', changedAfterIso)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) return result

  const rows = (data ?? []) as unknown as ApptRow[]

  for (const appt of rows) {
    const event = owedImmediateNotice(
      {
        status: appt.status,
        scheduleVersion: appt.schedule_version ?? 1,
        bookedVia: appt.booked_via,
        startsAt: appt.starts_at,
      },
      now,
    )
    if (!event) continue
    result.scanned++
    const outcome = await deliverLeg(db, appt, {
      event,
      offsetMinutes: IMMEDIATE,
      channel: 'sms',
      actor: 'agent:booking-reminders',
      durableConsentGranted: false,
    })
    if (outcome.sent) result.sent++
    else if (outcome.reason === 'already_delivered') result.skipped++
    else result.deferred++
  }
  return result
}
