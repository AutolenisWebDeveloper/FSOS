// Native booking — Google Calendar network exchange (Slice 7). SERVER-ONLY. Turns an
// authorization code into a stored credential, refreshes it, and reads busy windows via
// the freeBusy API. Isolated behind this adapter so Google request shapes never leak into
// routes or the availability assembler (§13.10).
//
// READ-ONLY GUARANTEE (ADR-027 §7): the only Google endpoints this module ever calls are
// the OAuth token endpoint, the OpenID userinfo endpoint (identity), and freeBusy (a
// read-only query). There is NO call to any calendar events write endpoint — enforced by
// the requested scope (calendar.readonly) and the no-write-back source scan test.
//
// Token material is returned only as a CredentialEnvelope for immediate encryption via
// booking_calendar_set_secret; it is never logged and never client-exposed.

import {
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  GOOGLE_FREEBUSY_URL,
  CALENDAR_READONLY_SCOPE,
  calendarProviderConfig,
  calendarClientSecret,
  expiryFromExpiresIn,
  mapFreeBusyResponse,
  type BusyInterval,
  type CredentialEnvelope,
} from './oauth'

type Env = Record<string, string | undefined>

const TIMEOUT_MS = 15_000

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? TIMEOUT_MS)
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal })
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: resp.ok, status: resp.status, json }
  } finally {
    clearTimeout(timer)
  }
}

/** Provider error extraction that never echoes tokens. */
function providerError(json: Record<string, unknown>, fallback: string): string {
  const err = json.error
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const m = (err as Record<string, unknown>).message
    if (typeof m === 'string') return m
  }
  const d = json.error_description
  if (typeof d === 'string') return d
  return fallback
}

export interface CalendarOAuthConnection {
  envelope: CredentialEnvelope
  /** The connected Google account email (identity/display). The practice's own account. */
  accountEmail: string | null
  scopes: string[]
}

/** Exchange an authorization code for a credential + the connected account identity. */
export async function completeCalendarOAuth(
  args: { code: string; redirectUri: string },
  env: Env = process.env as Env,
): Promise<CalendarOAuthConnection> {
  const cfg = calendarProviderConfig(env)
  const secret = calendarClientSecret(env)
  if (!cfg.configured || !secret || !cfg.clientId) throw new Error('Google Calendar OAuth is not configured')

  const tok = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      client_id: cfg.clientId,
      client_secret: secret,
      redirect_uri: args.redirectUri,
    }),
  })
  if (!tok.ok) throw new Error(providerError(tok.json, 'Google token exchange failed'))
  const accessToken = String(tok.json.access_token || '')
  if (!accessToken) throw new Error('Google returned no access token')
  const refreshToken = typeof tok.json.refresh_token === 'string' ? tok.json.refresh_token : undefined
  const expiresAt = expiryFromExpiresIn(Number(tok.json.expires_in) || undefined)

  // Capture the scopes Google actually GRANTED so partial consent is detectable.
  const granted =
    typeof tok.json.scope === 'string' && tok.json.scope.trim()
      ? tok.json.scope.trim().split(/\s+/)
      : [CALENDAR_READONLY_SCOPE]

  // Identity: the connected account email (best-effort; never blocks the connect).
  let accountEmail: string | null = null
  try {
    const info = await fetchJson(GOOGLE_USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } })
    if (info.ok && typeof info.json.email === 'string') accountEmail = info.json.email
  } catch {
    // identity is optional — leave null
  }

  return { envelope: { accessToken, refreshToken, expiresAt, tokenType: 'Bearer' }, accountEmail, scopes: granted }
}

/** Refresh the access token using the stored refresh_token. Returns null when refresh is
 *  impossible (no refresh_token) or fails — the caller degrades to native availability. */
export async function refreshCalendarCredential(
  envelope: CredentialEnvelope,
  env: Env = process.env as Env,
): Promise<CredentialEnvelope | null> {
  const cfg = calendarProviderConfig(env)
  const secret = calendarClientSecret(env)
  if (!cfg.configured || !secret || !cfg.clientId || !envelope.refreshToken) return null
  const tok = await fetchJson(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: envelope.refreshToken,
      client_id: cfg.clientId,
      client_secret: secret,
    }),
  })
  if (!tok.ok) return null
  const accessToken = String(tok.json.access_token || '')
  if (!accessToken) return null
  return {
    accessToken,
    refreshToken: envelope.refreshToken, // Google does not reissue it on refresh
    expiresAt: expiryFromExpiresIn(Number(tok.json.expires_in) || undefined),
    tokenType: 'Bearer',
  }
}

export type FreeBusyResult =
  | { ok: true; busy: BusyInterval[] }
  | { ok: false; status: number; error: string }

/**
 * Read busy windows for a calendar over [timeMin, timeMax] (UTC ISO). READ-ONLY: freeBusy
 * is a query, not a mutation, and returns only start/end instants — no event details.
 */
export async function fetchFreeBusy(args: {
  accessToken: string
  calendarId: string
  timeMinIso: string
  timeMaxIso: string
}): Promise<FreeBusyResult> {
  const res = await fetchJson(GOOGLE_FREEBUSY_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${args.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      timeMin: args.timeMinIso,
      timeMax: args.timeMaxIso,
      items: [{ id: args.calendarId }],
    }),
  })
  if (!res.ok) return { ok: false, status: res.status, error: providerError(res.json, `freeBusy failed (${res.status})`) }
  return { ok: true, busy: mapFreeBusyResponse(res.json, args.calendarId) }
}
