// src/lib/comms/deliverability-core.ts
// PURE core (no DB, no clock, no imports) for email-deliverability suppression.
// Decides whether a Resend `email.bounced` / `email.complained` event must suppress
// the recipient, and with what truthful reason. The impure orchestrator
// (deliverability.ts) feeds the decision into the EXISTING suppressContact() →
// dnc_entries path that gate step 3 (§12) already enforces — this file introduces
// no new suppression store.
//
// Offline-testable (tests/comms-deliverability-suppression.test.mjs), matching the
// established FSOS pure-core → impure-recorder pattern (cf. unsubscribe-core.ts).

/** The two Resend email events that can result in a suppression. */
export type DeliverabilityEvent = 'bounced' | 'complained'

/** The truthful cause recorded on the suppression (dnc_entries.reason + audit). */
export type DeliverabilityReason = 'hard_bounce' | 'spam_complaint'

/**
 * The bounce sub-object Resend attaches to an `email.bounced` event. Fields are
 * optional/loosely typed because the provider's exact taxonomy is not contractually
 * guaranteed (§4.3 — no invented data): we classify from whatever signal is present
 * and fall back to the conservative default.
 */
export interface BouncePayload {
  type?: string | null
  subType?: string | null
  classification?: string | null
  message?: string | null
}

/**
 * True unless the bounce is EXPLICITLY transient/soft/delayed. An unclassified or
 * unknown bounce is treated as hard — the conservative choice for deliverability and
 * CAN-SPAM (never keep emailing an address that permanently bounced). A genuinely
 * temporary failure surfaces as `email.delivery_delayed` (mapped to 'sent'
 * upstream), so it never reaches this path.
 */
export function isHardBounce(bounce?: BouncePayload | null): boolean {
  const kind = [bounce?.type, bounce?.subType, bounce?.classification, bounce?.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (/transient|soft|delayed|temporary|throttl/.test(kind)) return false
  return true
}

/**
 * Classify a deliverability event into a suppression decision, or null when the
 * event must NOT suppress (a soft/transient bounce). A spam complaint always
 * suppresses; a bounce suppresses only when hard.
 */
export function classifyDeliverabilityEvent(
  event: DeliverabilityEvent,
  bounce?: BouncePayload | null,
): { reason: DeliverabilityReason } | null {
  if (event === 'complained') return { reason: 'spam_complaint' }
  if (event === 'bounced') return isHardBounce(bounce) ? { reason: 'hard_bounce' } : null
  return null
}

/**
 * Truthful provenance for the suppression so the dnc_entries row and the audit /
 * consent-revoke reflect the ACTUAL cause (not the generic 'unsubscribe'). Feeds
 * suppressContact()'s optional provenance argument.
 */
export function suppressionProvenanceFor(
  reason: DeliverabilityReason,
): { dncReason: string; source: string; reason: string } {
  return reason === 'spam_complaint'
    ? { dncReason: 'spam_complaint', source: 'resend_complaint', reason: 'spam complaint (Resend)' }
    : { dncReason: 'hard_bounce', source: 'resend_bounce', reason: 'email hard bounce (Resend)' }
}
