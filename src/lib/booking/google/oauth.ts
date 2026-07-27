// Native booking — Google Calendar OAuth core (Slice 7). PURE, offline-testable logic
// for the READ-ONLY busy-sync connect flow: provider configuration, the authorize-URL
// builder, signed expiring CSRF state, the encrypted credential envelope, and the pure
// freeBusy → busy-interval mapper. No Next runtime, no DB, no network here — the network
// exchange lives in ./exchange.ts and the routes wire them together.
//
// WHY BOOKING-LOCAL (not the social OAuth module): the social module is frozen, and a
// booking calendar credential belongs to the booking bounded context, not social_channels
// (§6). This conforms to the SAME proven techniques (HMAC-signed state, credential
// envelope, pgcrypto-at-rest) as social/oauth.ts, kept inside booking.
//
// SECURITY
//   • ONE-WAY, READ-ONLY: the ONLY scope requested is calendar.readonly. There is no
//     write scope and no event-mutation code anywhere in this module (guardrail-scanned).
//   • The client secret never reaches the browser; providerConfig() returns the public
//     client id + scopes only, the secret accessor is separate and server-only.
//   • The OAuth `state` is an HMAC-signed, expiring token (CSRF defense), verified
//     constant-time and bound to a per-request nonce cookie by the routes.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

type Env = Record<string, string | undefined>

/** The single READ-ONLY scope. FSOS never requests calendar write access (ADR-027 §7). */
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
export const GOOGLE_FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'

/** Client id/secret env var names (dedicated first, then generic Google fallback). */
export const CALENDAR_CLIENT_ID_ENV = ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CLIENT_ID']
export const CALENDAR_CLIENT_SECRET_ENV = ['GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET']

/** httpOnly cookie holding the per-request nonce the callback binds the signed state to. */
export const CALENDAR_OAUTH_NONCE_COOKIE = 'booking_calendar_oauth_nonce'

function firstEnv(names: string[], env: Env): string | undefined {
  for (const n of names) {
    const v = env[n]
    if (v && v.trim()) return v.trim()
  }
  return undefined
}

export interface CalendarProviderConfig {
  configured: boolean
  clientId?: string
  scopes: string[]
  authorizeUrl: string
  tokenUrl: string
  /** Human reason when not configured (env vars to set). Never leaks the secret. */
  reason?: string
}

/** Public provider config (safe to surface to the UI). `configured` is true only when
 *  BOTH the client id and secret are present in the environment. */
export function calendarProviderConfig(env: Env = process.env as Env): CalendarProviderConfig {
  const clientId = firstEnv(CALENDAR_CLIENT_ID_ENV, env)
  const clientSecret = firstEnv(CALENDAR_CLIENT_SECRET_ENV, env)
  const configured = !!clientId && !!clientSecret
  return {
    configured,
    clientId,
    scopes: [CALENDAR_READONLY_SCOPE],
    authorizeUrl: GOOGLE_AUTHORIZE_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    reason: configured
      ? undefined
      : `Google Calendar sync is not configured for this environment — set ${CALENDAR_CLIENT_ID_ENV[0]} and ${CALENDAR_CLIENT_SECRET_ENV[0]}.`,
  }
}

/** True only when the OAuth client credentials are present. The gate that makes busy-sync
 *  not_configured-safe: false → callers skip Google entirely and use native availability. */
export function googleCalendarConfigured(env: Env = process.env as Env): boolean {
  return calendarProviderConfig(env).configured
}

/** Server-only client-secret accessor. NEVER call this in client-facing code. */
export function calendarClientSecret(env: Env = process.env as Env): string | undefined {
  return firstEnv(CALENDAR_CLIENT_SECRET_ENV, env)
}

export function buildAuthorizeUrl(args: { config: CalendarProviderConfig; redirectUri: string; state: string }): string {
  const { config, redirectUri, state } = args
  const u = new URL(config.authorizeUrl)
  u.searchParams.set('client_id', config.clientId ?? '')
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', config.scopes.join(' '))
  u.searchParams.set('state', state)
  // Offline access + forced consent so Google issues a refresh_token for silent renewal.
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('include_granted_scopes', 'true')
  return u.toString()
}

// ── Signed CSRF state ────────────────────────────────────────────────────────
export interface OAuthState {
  /** Namespaced marker so a booking state can't be replayed as a social one. */
  kind: 'booking_calendar'
  nonce: string
  /** Absolute epoch ms after which the state is invalid. */
  exp: number
}

export function newNonce(): string {
  return randomBytes(16).toString('base64url')
}

export function signState(state: OAuthState, key: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url')
  const sig = createHmac('sha256', key).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyState(token: string, key: string, nowMs: number = Date.now()): OAuthState | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', key).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  let parsed: OAuthState
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || parsed.kind !== 'booking_calendar') return null
  if (typeof parsed.nonce !== 'string' || typeof parsed.exp !== 'number') return null
  if (parsed.exp <= nowMs) return null
  return parsed
}

/** HMAC key for the OAuth state token — falls back to the credential-encryption key so a
 *  single secret configures the whole calendar OAuth path in dev. */
export function calendarOAuthStateKey(env: Env = process.env as Env): string {
  return (
    env.BOOKING_CALENDAR_OAUTH_STATE_KEY ||
    env.BOOKING_CALENDAR_TOKEN_KEY ||
    env.SOCIAL_TOKEN_KEY ||
    'fsos-dev-booking-calendar-oauth-state-change-me'
  )
}

/** Symmetric key for the pgcrypto credential encryption (booking_calendar_set_secret). */
export function calendarTokenKey(env: Env = process.env as Env): string {
  return (
    env.BOOKING_CALENDAR_TOKEN_KEY ||
    env.SOCIAL_TOKEN_KEY ||
    env.FSOS_SOCIAL_TOKEN_KEY ||
    'fsos-dev-booking-calendar-key-change-me'
  )
}

// ── Credential envelope (encrypted at rest via pgcrypto) ─────────────────────
export interface CredentialEnvelope {
  accessToken: string
  refreshToken?: string
  /** ISO string; when present, drives refresh-before-use. */
  expiresAt?: string | null
  tokenType?: string
}

export function serializeCredential(env: CredentialEnvelope): string {
  return JSON.stringify({
    access_token: env.accessToken,
    refresh_token: env.refreshToken || undefined,
    expires_at: env.expiresAt || undefined,
    token_type: env.tokenType || undefined,
  })
}

export function parseCredential(secret: string | null | undefined): CredentialEnvelope | null {
  if (!secret) return null
  const s = secret.trim()
  if (!s || !s.startsWith('{')) return null
  try {
    const j = JSON.parse(s) as Record<string, unknown>
    if (j && typeof j.access_token === 'string' && j.access_token) {
      return {
        accessToken: j.access_token,
        refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : undefined,
        expiresAt: typeof j.expires_at === 'string' ? j.expires_at : null,
        tokenType: typeof j.token_type === 'string' ? j.token_type : undefined,
      }
    }
  } catch {
    return null
  }
  return null
}

export function credentialNeedsRefresh(
  env: CredentialEnvelope | null,
  nowMs: number = Date.now(),
  skewMs = 120_000,
): boolean {
  if (!env || !env.expiresAt) return false
  const t = Date.parse(env.expiresAt)
  if (!Number.isFinite(t)) return false
  return t - skewMs <= nowMs
}

/** Compute an ISO expiry from an `expires_in` seconds value returned by Google. */
export function expiryFromExpiresIn(expiresIn: number | undefined, nowMs: number = Date.now()): string | null {
  if (!expiresIn || !Number.isFinite(expiresIn) || expiresIn <= 0) return null
  return new Date(nowMs + expiresIn * 1000).toISOString()
}

/** Absolute app base URL (env-configurable) for building the OAuth redirect_uri. */
export function appBaseUrl(env: Env = process.env as Env): string {
  const raw =
    env.NEXT_PUBLIC_APP_URL || env.APP_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '') || ''
  return raw.replace(/\/$/, '')
}

/** The exact redirect_uri — MUST match what is registered with Google and be identical
 *  between the start and callback legs. */
export function calendarRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/app/booking/calendar/oauth/callback`
}

// ── Pure freeBusy → busy-interval mapper ─────────────────────────────────────
/** A busy interval in UTC ISO — structurally the calculator's BusyBlock. */
export interface BusyInterval {
  startsAt: string
  endsAt: string
}

/**
 * Map a Google Calendar freeBusy API response to normalized UTC-ISO busy intervals.
 * Google returns each calendar's `busy: [{ start, end }]` as offset-bearing RFC3339;
 * we normalize to UTC ISO (`new Date(rfc3339).toISOString()`) to match BusyBlock. Only
 * time ranges are read — freeBusy carries no titles/attendees, so nothing sensitive is
 * ever surfaced. Malformed/partial entries are skipped, never thrown on.
 */
export function mapFreeBusyResponse(json: unknown, calendarId: string): BusyInterval[] {
  const out: BusyInterval[] = []
  const calendars = (json as { calendars?: Record<string, unknown> } | null)?.calendars
  if (!calendars || typeof calendars !== 'object') return out
  const cal = (calendars as Record<string, unknown>)[calendarId] as { busy?: unknown } | undefined
  const busy = Array.isArray(cal?.busy) ? (cal!.busy as unknown[]) : []
  for (const b of busy) {
    const row = b as { start?: unknown; end?: unknown }
    if (typeof row.start !== 'string' || typeof row.end !== 'string') continue
    const s = Date.parse(row.start)
    const e = Date.parse(row.end)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue
    out.push({ startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() })
  }
  return out
}
