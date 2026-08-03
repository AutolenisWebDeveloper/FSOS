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
import { buildBookingContext, DEFAULT_REMINDER_LEAD_HOURS } from './notify-core'
import { type LifecycleEvent, sourceKeyFor, dueReminderOffsets } from './notify-events'

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
  schedule_version: number | null
  reminder_sent_at: string | null
  cancel_token: string | null
  reschedule_token: string | null
  contacts: ContactRow | ContactRow[] | null
  appointment_types: TypeRow | TypeRow[] | null
}

const APPT_SELECT =
  'id, contact_id, starts_at, booker_timezone, meeting_mode, join_url, booked_at, status, schedule_version, reminder_sent_at, ' +
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

export type NotifyOutcome = { sent: boolean; reason?: string; messageId?: string }

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
  return {
    sent: outcome.sent,
    reason: outcome.sent ? undefined : outcome.reason ?? 'gate_blocked',
    messageId: outcome.messageId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P5 delivery ledger (mig 093) — the fire-once correctness core. One row per notice
// actually acted on, keyed UNIQUE(appointment_id, schedule_version, event, offset_minutes,
// channel). The claim is an atomic INSERT … ON CONFLICT DO NOTHING (upsert + ignoreDuplicates):
// a returned row = we won the claim and must send; no row = already delivered → skip. On a
// deferred/blocked leg the claim is DELETED so a later tick re-claims and retries (mirrors the
// legacy reminder_sent_at null→now→release). schedule_version (bumped by the reschedule mover)
// ties each delivery to a specific scheduled instant, so a reschedule re-arms every leg once.
// ─────────────────────────────────────────────────────────────────────────────

const DELIVERY_CONFLICT = 'appointment_id,schedule_version,event,offset_minutes,channel'

type ClaimResult = { id: string } | { skip: 'exists' | 'error' }

/** Atomically claim a delivery leg. Returns the new row id, or why it was not claimed. */
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
        status: 'sent',
      },
      { onConflict: DELIVERY_CONFLICT, ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()
  if (error) return { skip: 'error' }
  if (!data) return { skip: 'exists' } // ON CONFLICT DO NOTHING returned no row → already delivered
  return { id: data.id as string }
}

/** Persist the successful send's comm_messages link on the claimed ledger row. */
async function markDeliverySent(db: Db, id: string, messageId?: string): Promise<void> {
  await db
    .from('booking_notification_deliveries')
    .update({ status: 'sent', comm_message_id: messageId ?? null })
    .eq('id', id)
}

/** Release a claim (deferred/blocked leg) so a later tick can re-claim and retry. */
async function releaseDelivery(db: Db, id: string): Promise<void> {
  await db.from('booking_notification_deliveries').delete().eq('id', id)
}

/**
 * Deliver ONE email leg for a lifecycle event through the ledger: claim → send → record/release.
 * Fire-once is the UNIQUE-key claim; a deferred/blocked send releases the claim to retry. The
 * gate is unchanged — consent, quiet-hours, DNC, approved-template, recommendation, and the
 * securities firewall all re-check at send time exactly as for any other send.
 */
async function deliverEmailLeg(
  db: Db,
  appt: ApptRow,
  args: { event: LifecycleEvent; offsetMinutes: number; actor: string; durableConsentGranted: boolean },
): Promise<NotifyOutcome> {
  const scheduleVersion = appt.schedule_version ?? 1
  const claim = await claimDelivery(db, {
    appointmentId: appt.id,
    scheduleVersion,
    event: args.event,
    offsetMinutes: args.offsetMinutes,
    channel: 'email',
  })
  if ('skip' in claim) {
    return { sent: false, reason: claim.skip === 'exists' ? 'already_delivered' : 'ledger_error' }
  }
  const outcome = await sendAppointmentEmail(db, {
    sourceKey: sourceKeyFor(args.event, 'email'),
    appt,
    actor: args.actor,
    durableConsentGranted: args.durableConsentGranted,
  })
  if (outcome.sent) {
    await markDeliverySent(db, claim.id, outcome.messageId)
    return outcome
  }
  // Not sent (template not approved yet, quiet hours, transient block) → release the claim so a
  // later tick (reminders) or a re-invocation (immediate events) can retry.
  await releaseDelivery(db, claim.id)
  return outcome
}

/** Immediate lifecycle events (everything except the per-offset reminder) fire at offset 0. */
const IMMEDIATE = 0

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
  // Every immediate lifecycle notice is transactional (appointment-consent basis): the attendee
  // just booked / rescheduled / cancelled, or the advisor marked the outcome. Recap and no-show
  // stay transactional (thank-you / rebook only, no promo) so they ride the same durable email
  // consent — the moment either carries a product nudge it needs separate marketing consent.
  return deliverEmailLeg(db, data as unknown as ApptRow, {
    event,
    offsetMinutes: IMMEDIATE,
    actor: opts.actor ?? 'public',
    durableConsentGranted: true,
  })
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

interface ReminderConfig {
  offsets: number[] // minutes-before-start, positive, de-duped
  emailEnabled: boolean
  smsEnabled: boolean
}

/**
 * Load the reminder configuration (mig 093). When the config row/table is absent (e.g. before
 * the migration is applied) fall back to the single legacy 24h offset (via the env override) so
 * the pass degrades to the prior single-reminder behavior rather than erroring. `sms_enabled`
 * defaults OFF — the Stage-4 SMS feature flag.
 */
async function loadReminderConfig(db: Db): Promise<ReminderConfig> {
  const fallback: ReminderConfig = { offsets: [reminderLeadHours() * 60], emailEnabled: true, smsEnabled: false }
  try {
    const { data, error } = await db
      .from('booking_reminder_config')
      .select('offsets_minutes, email_enabled, sms_enabled')
      .eq('id', 'global')
      .maybeSingle()
    if (error || !data) return fallback
    const raw = Array.isArray(data.offsets_minutes) ? (data.offsets_minutes as number[]) : []
    const offsets = [...new Set(raw.map((n) => Math.trunc(n)).filter((n) => Number.isFinite(n) && n > 0))]
    return {
      offsets: offsets.length ? offsets : fallback.offsets,
      emailEnabled: data.email_enabled !== false,
      smsEnabled: data.sms_enabled === true,
    }
  } catch {
    return fallback
  }
}

/**
 * Sweep upcoming appointments and send each configured pre-appointment EMAIL reminder offset,
 * idempotently, through the P5 delivery ledger. The ledger's UNIQUE(appointment, schedule_version,
 * event, offset, channel) claim is the fire-once guarantee (replacing the single `reminder_sent_at`
 * boolean): overlapping cron ticks send each offset at most once, and a reschedule (which bumps
 * schedule_version) re-arms the new time's offsets exactly once each. A blocked/deferred send
 * releases its claim so a later in-hours tick retries; a no-consent contact is skipped without a
 * send. Email-only — SMS legs stay behind `sms_enabled` (Stage 4).
 */
export async function runBookingReminderPass(
  now: Date,
  opts: { limit?: number } = {},
): Promise<ReminderPassResult> {
  const db = getDb()
  const result: ReminderPassResult = { scanned: 0, sent: 0, deferred: 0, skipped: 0 }

  const config = await loadReminderConfig(db)
  if (!config.emailEnabled || config.offsets.length === 0) return result // email reminder channel off

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
    const due = dueReminderOffsets(
      { status: appt.status, startsAt: appt.starts_at, bookedAt: appt.booked_at },
      config.offsets,
      now,
    )
    if (due.length === 0) {
      result.skipped++
      continue
    }
    // Consent gate BEFORE claiming any offset — a no-consent contact is skipped, not retried.
    if (!appt.contact_id || !(await hasBookingEmailConsent(db, appt.contact_id))) {
      result.skipped++
      continue
    }
    for (const offset of due) {
      const outcome = await deliverEmailLeg(db, appt, {
        event: 'reminder',
        offsetMinutes: offset,
        actor: 'agent:booking-reminders',
        durableConsentGranted: true, // consent verified above
      })
      if (outcome.sent) result.sent++
      else if (outcome.reason === 'already_delivered') result.skipped++
      else result.deferred++ // template not approved / quiet hours / transient — claim released
    }
  }
  return result
}
