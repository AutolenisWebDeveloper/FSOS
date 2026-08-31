// src/lib/comms/opt-out.ts
// The ONE writer for a channel opt-out, wherever it arrives from.
//
// FSOS learns that someone opted out through two independent routes, and until now only one of
// them wrote anything:
//   • an inbound STOP keyword on our own number   → inbound.ts (kept every store in sync);
//   • a CARRIER-level opt-out reported by Twilio on the delivery callback as ErrorCode 21610
//     ("attempt to send to unsubscribed recipient") → recorded as an event detail string and
//     nothing else, so the very next appointment re-attempted the same suppressed number.
//     That second route is not hypothetical: Twilio's own Advanced Opt-Out absorbs the STOP at
//     the carrier, so the keyword never reaches our inbound webhook at all.
//
// Both now land here, so an opt-out means the same thing to every store regardless of how we
// found out about it:
//   dnc_entries          — the ENFORCED suppression (gate step `dnc`, checked on every send);
//   comm_contact_consents— the contact-resolvable evidence store (latest-wins), which is the
//                          ONLY consent record a public booker has;
//   consents / comm_consent_purposes — the member-keyed stores, when the number resolves to a
//                          household member (a channel revoke also cascades to every scoped
//                          purpose grant, so a scoped grant can never survive a STOP).
//
// Best-effort by contract: an opt-out must never throw into a webhook handler and cause the
// provider to retry. The DNC write is first precisely because it is the enforced one.

import { getDb } from '@/lib/supabase/client'
import { recordConsentChange } from './consent-events'

export type OptOutChannel = 'sms' | 'email'

export interface ChannelOptOut {
  /** Normalized contact key (normalizeContact / consentContactKey — they are byte-identical). */
  contact: string
  channel: OptOutChannel
  /** Provenance label recorded on the consent change, e.g. 'inbound_stop' or 'carrier_opt_out'. */
  source: string
  /** Human reason for the DNC row + audit trail. */
  reason: string
  /** Text stored as the consent record's evidence (what we know the person did). */
  consentText: string
  /** Version label for the consent record. Opt-outs use 'opt-out' (no disclosure was shown). */
  consentVersion?: string
  memberId?: string | null
  householdId?: string | null
}

/**
 * Apply a channel opt-out across every store, and log it once through the shared consent-change
 * recorder (audit_log + the CRM timeline). Never throws.
 */
export async function recordChannelOptOut(o: ChannelOptOut): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  try {
    // 1. The ENFORCED suppression. First, so a failure later still leaves the send blocked.
    await db
      .from('dnc_entries')
      .upsert({ contact: o.contact, channel: o.channel, scope: 'internal', reason: o.reason }, { onConflict: 'contact,channel' })

    // 2. The contact-resolvable evidence store (append-only; latest action wins).
    await db.from('comm_contact_consents').insert({
      contact: o.contact,
      channel: o.channel,
      action: 'revoked',
      consent_text: o.consentText,
      consent_version: o.consentVersion ?? 'opt-out',
      captured_at: now,
    })

    // 3. The member-keyed stores, when the number belongs to an existing client. The channel
    //    revoke is the floor and the scoped grants are cascaded so the two cannot disagree.
    if (o.memberId) {
      await db
        .from('consents')
        .upsert(
          { member_id: o.memberId, household_id: o.householdId ?? null, channel: o.channel, status: 'revoked', source: o.source, updated_at: now },
          { onConflict: 'member_id,channel' },
        )
      await db
        .from('comm_consent_purposes')
        .update({ status: 'revoked', updated_at: now })
        .eq('member_id', o.memberId)
        .eq('channel', o.channel)
    }

    // 4. ONE consent-logging path → audit_log AND the CRM timeline.
    await recordConsentChange({
      actor: 'system',
      channel: o.channel,
      newStatus: 'revoked',
      previousStatus: 'granted',
      source: o.source,
      reason: o.reason,
      memberId: o.memberId ?? null,
      householdId: o.householdId ?? null,
    })
  } catch {
    /* best-effort: a webhook must not retry on a logging failure */
  }
}

/**
 * Twilio delivery-callback error codes that mean the RECIPIENT has opted out, as opposed to a
 * delivery problem. Deliberately narrow: only 21610 is an unambiguous unsubscribe. Carrier
 * filtering (30007), unreachable handsets (30003/30005) and generic blocks (30004) are delivery
 * failures — suppressing on those would silently opt people out of messages they asked for.
 */
const CARRIER_OPT_OUT_CODES: ReadonlySet<string> = new Set(['21610'])

/** True when a Twilio ErrorCode means the recipient is unsubscribed at the carrier. */
export function isCarrierOptOutCode(code: string | null | undefined): boolean {
  return !!code && CARRIER_OPT_OUT_CODES.has(String(code).trim())
}
