// src/lib/comms/contact-consent.ts
// A2P 10DLC / TCPA — PURE decision core for durable, CONTACT-RESOLVABLE customer-care
// SMS consent captured at public intake (before a household member exists).
//
// This is the pure half of the standard comms build pattern (pure core → DB resolver →
// opt-in wiring, see twilio-a2p-compliance skill). It has NO database or clock imports so
// it is unit-testable offline (tests/comms-contact-consent.test.mjs). The DB read resolver
// lives inline in send.ts (alongside hasConsent/onDNC); the DB write is in the public
// contact route. Both use the helpers here so normalization + the latest-wins rule stay
// in ONE place.
//
// Store: comm_contact_consents (migration 074). Semantics: one row per consent ACTION
// (granted/revoked); the LATEST captured_at wins (a later revoke overrides an earlier
// grant). Absent any row ⇒ NOT granted (fail-closed: no positive consent, no enrollment).

export type ConsentChannel = 'sms' | 'email' | 'call'
export type ConsentAction = 'granted' | 'revoked'

export interface ConsentActionRow {
  action: ConsentAction | string
  /** ISO 8601 timestamp string (or anything Date-parsable). */
  captured_at: string
}

/**
 * Normalized storage/resolution key for a contact:
 *   • email → trimmed + lower-cased
 *   • sms/call → leading '+' preserved, all other non-digits stripped (best-effort E.164)
 * Kept byte-identical to conversations.normalizeContact so a value stored here matches the
 * `to` the send path resolves — but duplicated as a pure (db-free) helper so this module
 * stays offline-testable.
 */
export function consentContactKey(channel: ConsentChannel, raw: string): string {
  const v = (raw || '').trim()
  if (channel === 'email') return v.toLowerCase()
  const plus = v.startsWith('+') ? '+' : ''
  return plus + v.replace(/[^\d]/g, '')
}

/** Last 10 digits of a phone — used for tolerant (+1/bare-agnostic) suffix matching. */
export function smsTail(raw: string): string {
  return (raw || '').replace(/[^\d]/g, '').slice(-10)
}

/**
 * The latest consent decision for a contact+channel: TRUE iff the most-recent action is
 * `granted`. Rows may arrive in any order — the newest captured_at wins. Empty ⇒ false
 * (fail-closed). A row with an unparseable timestamp sorts as oldest so it can never
 * outrank a real, dated decision.
 */
export function latestConsentGranted(rows: ConsentActionRow[] | null | undefined): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false
  let best: ConsentActionRow | null = null
  let bestMs = -Infinity
  for (const r of rows) {
    const ms = Date.parse(r?.captured_at ?? '')
    const t = Number.isFinite(ms) ? ms : -Infinity
    if (t >= bestMs) {
      bestMs = t
      best = r
    }
  }
  return best?.action === 'granted'
}
