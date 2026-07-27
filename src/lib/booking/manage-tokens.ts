// src/lib/booking/manage-tokens.ts
// Signed, expiring, single-purpose self-service tokens for reschedule/cancel links (Slice 6,
// §4.4). The link carries an HMAC-signed envelope over the appointment's STORED opaque token
// (cancel_token / reschedule_token — 144-bit random, mig 069) plus a purpose and an expiry.
// The envelope exposes NO database id: the opaque token is looked up server-side to find the
// appointment. Mirrors the social OAuth state-token pattern (HMAC-SHA256, timing-safe).

import { createHmac, timingSafeEqual } from 'crypto'

export type ManagePurpose = 'cancel' | 'reschedule'

interface Envelope {
  /** The stored opaque cancel_token/reschedule_token (never the appointment uuid). */
  t: string
  p: ManagePurpose
  /** Absolute epoch ms after which the link is invalid. */
  exp: number
}

/** HMAC key for manage links — falls back so a single app secret configures dev. */
export function manageTokenKey(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.BOOKING_TOKEN_KEY ||
    env.FSOS_API_SECRET ||
    env.SOCIAL_TOKEN_KEY ||
    'fsos-dev-booking-token-key-change-me'
  )
}

export function signManageToken(opaqueToken: string, purpose: ManagePurpose, expMs: number, key: string): string {
  const payload = Buffer.from(JSON.stringify({ t: opaqueToken, p: purpose, exp: expMs } satisfies Envelope)).toString(
    'base64url',
  )
  const sig = createHmac('sha256', key).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/** Verify signature + expiry; returns the opaque token + purpose, or null if invalid/expired. */
export function verifyManageToken(
  token: string,
  key: string,
  nowMs: number = Date.now(),
): { opaqueToken: string; purpose: ManagePurpose } | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', key).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let parsed: Envelope
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed.t !== 'string' || !parsed.t) return null
  if (parsed.p !== 'cancel' && parsed.p !== 'reschedule') return null
  if (typeof parsed.exp !== 'number' || parsed.exp <= nowMs) return null
  return { opaqueToken: parsed.t, purpose: parsed.p }
}

/** Default manage-link lifetime: 120 days (covers max booking lead + slack). */
export const MANAGE_TOKEN_TTL_MS = 120 * 24 * 60 * 60 * 1000
