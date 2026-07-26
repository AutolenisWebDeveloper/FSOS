// src/lib/comms/unsubscribe-core.ts
// Three-life-campaigns launch — email deliverability (CAN-SPAM + RFC 8058 one-click).
//
// PURE helpers only (crypto + string/URL building) — no DB, no env, no '@/' imports —
// so the signing/verification and header construction are unit-testable offline
// (mirrors the simulation-core split). The impure wrapper `unsubscribe.ts` supplies
// siteUrl(), the reply inbox, and the signing secret, and performs the DB suppression.

import { createHmac, timingSafeEqual } from 'crypto'

export type UnsubChannel = 'email' | 'sms' | 'all'

/** Normalize a contact for STABLE signing (email → lowercase; phone → digits, keep +). */
export function normForSignature(contact: string): string {
  const v = (contact || '').trim()
  if (v.includes('@')) return v.toLowerCase()
  const plus = v.startsWith('+') ? '+' : ''
  return plus + v.replace(/[^\d]/g, '')
}

/**
 * Base64url HMAC-SHA256 over `${channel}:${normalizedContact}`. Returns '' when no
 * secret is configured (degraded/dev mode — see verifyUnsubscribe). The token binds a
 * one-click unsubscribe URL to a specific contact+channel so the public endpoint can't
 * be abused to suppress arbitrary recipients (§13.8 — no unauthenticated IDOR).
 */
export function signUnsubscribe(contact: string, channel: UnsubChannel, secret: string | null): string {
  if (!secret) return ''
  return createHmac('sha256', secret).update(`${channel}:${normForSignature(contact)}`).digest('base64url')
}

/**
 * Verify a one-click token. When no secret is configured, accept (dev/preview: the
 * endpoint still suppresses — opt-out is inherently low-risk and already public by
 * contact). When a secret IS configured, require an exact, constant-time match.
 */
export function verifyUnsubscribe(
  contact: string,
  channel: UnsubChannel,
  token: string | null | undefined,
  secret: string | null,
): boolean {
  if (!secret) return true
  if (!token) return false
  const expected = signUnsubscribe(contact, channel, secret)
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Human-facing preferences page URL (pre-filled). `base` is the site origin (no trailing slash). */
export function buildUnsubscribeUrl(base: string, contact: string, channel: UnsubChannel = 'email'): string {
  const u = new URL(`${base.replace(/\/$/, '')}/unsubscribe`)
  u.searchParams.set('c', contact)
  u.searchParams.set('ch', channel)
  return u.toString()
}

/** One-click (RFC 8058) endpoint URL for the List-Unsubscribe header — POST suppresses. */
export function oneClickUnsubscribeUrl(
  base: string,
  contact: string,
  channel: UnsubChannel,
  secret: string | null,
): string {
  const u = new URL(`${base.replace(/\/$/, '')}/api/comms/unsubscribe`)
  u.searchParams.set('c', contact)
  u.searchParams.set('ch', channel)
  const t = signUnsubscribe(contact, channel, secret)
  if (t) u.searchParams.set('t', t)
  return u.toString()
}

/**
 * RFC 2369 + RFC 8058 List-Unsubscribe headers for a marketing email. Modern bulk-sender
 * requirements (Gmail/Yahoo 2024) expect both a List-Unsubscribe (mailto + https) and a
 * List-Unsubscribe-Post one-click. `replyEmail` is the monitored opt-out mailbox.
 */
export function listUnsubscribeHeaders(args: {
  base: string
  replyEmail: string
  contact: string
  channel?: UnsubChannel
  secret: string | null
}): Record<string, string> {
  const channel = args.channel ?? 'email'
  const https = oneClickUnsubscribeUrl(args.base, args.contact, channel, args.secret)
  const mailto = `mailto:${args.replyEmail}?subject=unsubscribe`
  return {
    'List-Unsubscribe': `<${mailto}>, <${https}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
