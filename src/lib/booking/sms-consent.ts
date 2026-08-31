// src/lib/booking/sms-consent.ts
// Booking-time SMS consent CAPTURE (TCPA prior express written consent / A2P 10DLC).
//
// The booking form collects the opt-in inline, BEFORE the appointment is submitted, so the
// confirmation text can go out immediately after the booking succeeds — there is deliberately
// no second, post-booking consent step that would delay or block the confirmation.
//
// This module owns everything that happens once that affirmative opt-in arrives. It writes to
// the EXISTING consent stores the send-time gate already reads — it never introduces a second
// consent path (§6, one SMS consent source of truth):
//
//   • comm_contact_consents (mig 074 + 135) — the CONTACT-RESOLVABLE grant, keyed by the
//     normalized phone. This is what dispatch-policy.ts resolves for a recipient who is not a
//     household member, i.e. the ordinary public booker. It also carries the TCPA evidence:
//     the exact disclosure text, its content-derived version, source URL, IP, user agent, and
//     (mig 135) the appointment + contact this consent was captured at.
//
//   • comm_consent_purposes (mig 055) — a PURPOSE-SCOPED `APPOINTMENT_REMINDERS` grant, written
//     only when the phone resolves to an existing household member. It is needed because the
//     gate deliberately ignores contact-level consent once a member resolves
//     (dispatch-policy.ts: `memberId ? false : contactConsent(...)`), so without this an
//     existing client who ticks the box at booking would never receive the text they asked for.
//     It is PURPOSE-scoped, never a channel-wide `consents` grant, because the booking
//     disclosure covers customer-care messaging only — a channel-wide grant would also open
//     the marketing lane the booker never agreed to.
//
// FAIL-SAFE IN BOTH DIRECTIONS. An unchecked box writes nothing at all (absence of a row is
// "no consent", never "not yet revoked"). A member whose channel-wide SMS consent is REVOKED
// (a prior STOP) gets NO purpose grant — an opt-out is never resurrected by a later form tick;
// the booker must START/UNSTOP through the carrier keyword path, which is the only route that
// also clears the DNC row.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { SMS_CONSENT, siteUrl } from '@/lib/site'
import { consentContactKey } from '@/lib/comms/contact-consent'
import { smsConsentVersion } from '@/lib/comms/consent-version'
import { recordConsentChange } from '@/lib/comms/consent-events'

/** What happened to the member-scoped leg of the capture (evidence + observability). */
export type MemberGrantOutcome =
  | 'not_a_member' // the phone does not resolve to a household member — contact-level grant is authoritative
  | 'granted' // APPOINTMENT_REMINDERS purpose grant written for the member
  | 'withheld_channel_revoked' // a prior channel-level opt-out stands; never resurrected by a form tick
  | 'error' // the write failed; the contact-level grant still stands

/**
 * PURE decision: may a booking opt-in write the member's purpose-scoped appointment grant?
 * Only when no channel-level revoke stands. Split out so the opt-out-never-resurrected rule is
 * provable offline (tests/booking-sms-consent.test.mjs) without a database.
 */
export function mayGrantMemberAppointmentConsent(channelStatus: string | null | undefined): boolean {
  return channelStatus !== 'revoked'
}

/**
 * True when a Postgres error is specifically "that column does not exist" for the migration-135
 * evidence-linkage columns. Deliberately narrow (mirrors booking/insert-errors.ts): any other
 * failure must NOT be retried with a degraded row.
 */
function isMissingBookingConsentColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const message = (error.message ?? '').toLowerCase()
  const undefinedColumn = error.code === '42703' || message.includes('does not exist') || message.includes('could not find')
  return undefinedColumn && (message.includes('appointment_id') || message.includes('contact_id'))
}

export interface BookingSmsConsentInput {
  /** Spine contact resolved (or created) for the booker. */
  contactId: string
  /** The appointment the consent was captured at — the booking reference on the evidence row. */
  appointmentId: string
  /** The mobile number the booker supplied (validated ≥10 digits by PublicBookingInput). */
  phone: string
  /** Capture instant, UTC ISO — injected so the record is deterministic and testable. */
  capturedAt: string
  /** Server-derived request context (TCPA/A2P evidence). */
  ip?: string | null
  userAgent?: string | null
}

export interface BookingSmsConsentResult {
  /** The contact-level grant row was written (the enforceable read-path record). */
  recorded: boolean
  /** Content-derived version of the disclosure the booker actually saw. */
  consentVersion: string
  /** Normalized storage key the gate suffix-matches at send time. */
  contactKey: string
  memberId: string | null
  memberGrant: MemberGrantOutcome
}

/**
 * Record an affirmative booking SMS opt-in across every store the gate reads, plus the
 * append-only evidence trail. Best-effort by contract: the appointment is already committed,
 * so nothing here throws into the caller. A failure degrades to "no consent recorded", which
 * fail-closes the SMS leg rather than sending without proof.
 */
export async function captureBookingSmsConsent(
  input: BookingSmsConsentInput,
): Promise<BookingSmsConsentResult> {
  const db = getDb()
  const consentVersion = smsConsentVersion()
  const contactKey = consentContactKey('sms', input.phone)
  const sourceUrl = `${siteUrl()}/schedule`
  const result: BookingSmsConsentResult = {
    recorded: false,
    consentVersion,
    contactKey,
    memberId: null,
    memberGrant: 'not_a_member',
  }

  // Resolve the member with the SAME resolver the send gate uses (conversations.resolveContact),
  // so "does this recipient count as a member?" can never be answered differently at capture
  // time than at send time.
  try {
    const { resolveContact } = await import('@/lib/comms/conversations')
    const link = await resolveContact('sms', input.phone)
    result.memberId = link.memberId ?? null
  } catch {
    result.memberId = null
  }

  // 1. The enforceable contact-level grant + its TCPA evidence (mig 074 + 135).
  const evidence = {
    contact: contactKey,
    channel: 'sms',
    action: 'granted',
    consent_text: SMS_CONSENT.disclosure, // exact wording rendered at the checkbox (verbatim-synced)
    consent_version: consentVersion, // content-derived — proves WHICH wording the booker saw
    source_url: sourceUrl,
    ip_address: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    member_id: result.memberId,
    captured_at: input.capturedAt,
  }
  let { error: grantError } = await db
    .from('comm_contact_consents')
    .insert({ ...evidence, contact_id: input.contactId, appointment_id: input.appointmentId })

  // Deploy-order resilience (ADR-039): code and DB migrations ship independently, so this build
  // can reach production before migration 135 adds appointment_id/contact_id. Those columns are
  // evidence LINKAGE — losing them is bad, but losing the grant itself is far worse: the gate
  // would find no consent and the booker would silently get no text at all, having just asked
  // for one. So if (and only if) the failure is the missing column, retry with the columns the
  // pre-135 schema has, and log loudly so the un-applied migration is visible in ops.
  if (grantError && isMissingBookingConsentColumn(grantError)) {
    console.error(
      '[booking] comm_contact_consents.appointment_id/contact_id not found — recording SMS consent ' +
        'WITHOUT the booking reference. Apply migration 135_booking_sms_appointment_notices.sql.',
    )
    ;({ error: grantError } = await db.from('comm_contact_consents').insert(evidence))
  }
  result.recorded = !grantError
  if (grantError) {
    // Nothing above throws, so without this the only trace of a lost consent record would be the
    // absent SMS. The audit row below records granted:false for the same reason.
    console.error('[booking] SMS consent capture FAILED — no grant recorded', {
      appointment: input.appointmentId,
      contact: input.contactId,
      error: grantError.message,
    })
  }

  // 2. The member-scoped appointment grant, when the number belongs to an existing client.
  if (result.memberId) {
    try {
      const { data: channelRow } = await db
        .from('consents')
        .select('status')
        .eq('member_id', result.memberId)
        .eq('channel', 'sms')
        .maybeSingle()
      if (!mayGrantMemberAppointmentConsent(channelRow?.status)) {
        result.memberGrant = 'withheld_channel_revoked'
      } else {
        const { error } = await db.from('comm_consent_purposes').upsert(
          {
            member_id: result.memberId,
            channel: 'sms',
            purpose: 'APPOINTMENT_REMINDERS',
            status: 'granted',
            source: 'booking_sms_optin',
            disclosure: SMS_CONSENT.disclosure,
            captured_at: input.capturedAt,
            revoked_at: null,
            updated_at: input.capturedAt,
          },
          { onConflict: 'member_id,channel,purpose' },
        )
        result.memberGrant = error ? 'error' : 'granted'
        if (!error) {
          // ONE consent-logging path → audit_log + the CRM timeline, anchored to the member.
          await recordConsentChange({
            actor: 'public',
            channel: 'sms',
            newStatus: 'granted',
            previousStatus: channelRow?.status === 'granted' ? 'granted' : 'none',
            source: 'booking_sms_optin',
            reason: `Appointment SMS opt-in captured at booking (${consentVersion})`,
            memberId: result.memberId,
          })
        }
      }
    } catch {
      result.memberGrant = 'error'
    }
  }

  // 3. CRM timeline note on the contact (visible on the Contact 360 next to the booking).
  await db
    .from('activities')
    .insert({
      entity_type: 'contact',
      entity_id: input.contactId,
      kind: 'consent_intent',
      note: `SMS appointment-notification consent captured at booking (${consentVersion}).`,
      actor: 'public',
    })
    .then(
      () => undefined,
      () => undefined,
    )

  // 4. Immutable evidence-of-record (append-only, tamper-locked mig 077). Structured so a TCPA
  //    dispute reconstructs who/when/where/what-they-saw AND which booking it was captured at.
  //    The phone is stored as last-4 only — the full number lives on the consent row, not in the log.
  await writeAudit({
    actor: 'public',
    action: 'consent.captured',
    entity: 'contact',
    entityId: input.contactId,
    diff: {
      channel: 'sms',
      scope: 'booking',
      granted: result.recorded,
      appointmentId: input.appointmentId,
      consentVersion,
      consentText: SMS_CONSENT.disclosure,
      sourceUrl,
      capturedAt: input.capturedAt,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      phone_tail: input.phone.replace(/\D/g, '').slice(-4),
      memberId: result.memberId,
      memberGrant: result.memberGrant,
    },
  })

  return result
}
