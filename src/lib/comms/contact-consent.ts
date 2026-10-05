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

/**
 * A DNC row is LIFTED when a bare START restored a keyword opt-out after the row was last armed
 * (owner decision 4: never delete a DNC row). A later STOP re-arms the same row by refreshing
 * `created_at` (opt-out.ts), so `lifted_at` must be strictly newer than `created_at`. A row read
 * without a `lifted_at` field (column not yet migrated) is NOT lifted — the restrictive default.
 */
export function isDncLifted(row: { created_at?: string | null; lifted_at?: string | null } | null | undefined): boolean {
  if (!row || !row.lifted_at) return false
  const lifted = Date.parse(row.lifted_at)
  const armed = row.created_at ? Date.parse(row.created_at) : NaN
  if (Number.isNaN(lifted)) return false
  if (Number.isNaN(armed)) return false
  return lifted > armed
}

/**
 * True when a DNC row's reason says it was written by a STOP KEYWORD (inbound STOP, or the carrier
 * reporting 21610) — the only kind of opt-out a bare START may restore (owner decision 4). Every
 * other writer (unsubscribe link, web/portal opt-out, bounce, complaint, operator) records its own
 * reason, and opt-out.ts never relabels such a row as a keyword one, so it can never be lifted.
 */
/**
 * Evidence marker on the append-only `comm_contact_consents` REVOKE row an opt-out writes: the
 * member-keyed consent that existed BEFORE the opt-out overwrote it. A bare START restores consent
 * only from documented prior evidence (owner decision 4), and the member store keeps no history.
 */
export const PRIOR_MEMBER_GRANT_MARKER = 'member consent before this opt-out: granted'

export function isKeywordOptOutReason(reason: string | null | undefined): boolean {
  const r = reason ?? ''
  return r.startsWith('inbound STOP') || r.startsWith('Twilio ErrorCode 21610')
}

/** consent_version stamped on the contact-level REVOKE evidence row a STOP keyword writes. */
export const KEYWORD_OPT_OUT_VERSION = 'opt-out-keyword'

/**
 * True when a comm_contact_consents REVOKE evidence row was written by a STOP keyword (inbound, or
 * the carrier's 21610) — the only opt-out a bare START may undo (owner decision 4). Rows written
 * before the version stamp are recognised by the keyword writer's own text. Every other opt-out
 * (unsubscribe, one-click, web/portal, bounce, complaint, DNC add) records non-keyword evidence,
 * and its presence keeps START from lifting the address's DNC row even when that row was first
 * written by a STOP (the DNC row keeps its first reason; it is never relabelled).
 */
export function isKeywordRevokeEvidence(row: { consent_version?: string | null; consent_text?: string | null } | null | undefined): boolean {
  if (!row) return false
  if (row.consent_version === KEYWORD_OPT_OUT_VERSION) return true
  const t = row.consent_text ?? ''
  return t.startsWith('Inbound STOP keyword') || t.startsWith('Carrier-reported opt-out')
}

/** consents.source values the STOP-keyword writers record (inbound STOP, carrier 21610). */
export const KEYWORD_OPT_OUT_SOURCES: readonly string[] = ['inbound_stop', 'carrier_opt_out']
