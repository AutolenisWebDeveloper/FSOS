// src/lib/comms/senders.ts
// Single source of truth for the outbound EMAIL envelope-From, keyed on reputation
// STREAM (transactional vs marketing) so the two streams can send from different
// verified subdomains and a marketing complaint never poisons the transactional
// (relationship-class) reputation.
//
// This does NOT introduce a new send path — the app's one Resend choke-point stays
// `lib/messaging.sendEmail`, and the one gated path stays `comms/dispatcher`. This
// module only RESOLVES the From (analogous to `unsubscribe.replyToAddress()`), read
// lazily from config so identities change in one place and `npm run build` stays green.
//
// OPT-IN + NON-BREAKING: when the per-stream env vars are unset, BOTH streams fall
// back to the existing single `RESEND_FROM_EMAIL` — behavior is identical to today
// until the owner verifies the notify./mail. subdomains in Resend and sets the env.
// It never invents a sender (§4.3).

import { isMarketingPurpose, type MessagePurpose } from './purpose'

export type EmailStream = 'transactional' | 'marketing'

export interface SenderIdentity {
  stream: EmailStream
  /** Envelope From, e.g. "Markist Athelus <notify@notify.markistfsa.com>". */
  from: string
  /** Per-stream Reply-To override; undefined → the caller's/dispatcher default wins. */
  replyTo?: string
  /** Sending domain parsed from `from` (the reputation stream), or null if unparseable. */
  sendingDomain: string | null
}

/** The pre-stream single-domain sender every stream falls back to (legacy default). */
function baseFrom(): string | undefined {
  return process.env.RESEND_FROM_EMAIL || undefined
}

/** Extract the domain from a From header value ("Name <a@b.com>" or "a@b.com"). */
export function emailDomainOf(from: string | undefined | null): string | null {
  if (!from) return null
  const m = /<([^>]+)>/.exec(from)
  const addr = (m ? m[1] : from).trim()
  const at = addr.lastIndexOf('@')
  if (at < 0) return null
  return addr.slice(at + 1).toLowerCase() || null
}

/**
 * Resolve the sender identity for a stream. Each stream prefers its own env var and
 * otherwise falls back to the legacy `RESEND_FROM_EMAIL` — the two streams fall back
 * INDEPENDENTLY (marketing never lands on the transactional subdomain, and vice-versa),
 * so partial configuration can't cross-contaminate reputation.
 */
export function resolveSender(stream: EmailStream): SenderIdentity {
  const fallback = baseFrom()
  if (stream === 'marketing') {
    const from = process.env.EMAIL_MARKETING_FROM || fallback || ''
    return { stream, from, replyTo: process.env.EMAIL_MARKETING_REPLY_TO || undefined, sendingDomain: emailDomainOf(from) }
  }
  const from = process.env.EMAIL_TRANSACTIONAL_FROM || fallback || ''
  return { stream, from, replyTo: process.env.EMAIL_TRANSACTIONAL_REPLY_TO || undefined, sendingDomain: emailDomainOf(from) }
}

/**
 * Map a message purpose to its reputation stream. Marketing/workshop → marketing;
 * every other purpose → transactional. An ABSENT purpose defaults to marketing because
 * the gated dispatcher path is the automated campaign/agent path — defaulting there to
 * the marketing stream keeps the transactional (notify.) reputation isolated from bulk
 * campaign sends. Purpose→marketing classification reuses the existing purpose taxonomy
 * (purpose.ts) rather than a second one.
 */
export function streamForPurpose(purpose?: MessagePurpose | null): EmailStream {
  if (!purpose) return 'marketing'
  return isMarketingPurpose(purpose) ? 'marketing' : 'transactional'
}
