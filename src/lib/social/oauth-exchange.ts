// Social OAuth network exchange (ADR-026). SERVER-ONLY. Talks to Google / Meta to
// turn an authorization code into a stored credential, to refresh it, and to verify
// a connection's health. Isolated behind this adapter so provider-specific request
// shapes never leak into routes or the publisher (build instruction §13.10).
//
// Token material is returned only as a CredentialEnvelope for immediate encryption
// via social_channel_set_secret; it is never logged and never client-exposed.

import {
  SOCIAL_OAUTH_PROVIDERS,
  providerClientSecret,
  providerConfig,
  expiryFromExpiresIn,
  type CredentialEnvelope,
  type OAuthPlatform,
} from './oauth'

type Env = Record<string, string | undefined>

export interface OAuthConnection {
  envelope: CredentialEnvelope
  externalAccountId: string
  displayName: string | null
  scopes: string[]
}

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

/** Provider error message extraction that never echoes tokens. */
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

// ── YouTube (Google) ─────────────────────────────────────────────────────────
async function completeYouTube(code: string, redirectUri: string, env: Env): Promise<OAuthConnection> {
  const cfg = providerConfig('youtube', env)
  const secret = providerClientSecret('youtube', env)
  if (!cfg.configured || !secret || !cfg.clientId) throw new Error('YouTube OAuth is not configured')

  const tok = await fetchJson(SOCIAL_OAUTH_PROVIDERS.youtube.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: cfg.clientId,
      client_secret: secret,
      redirect_uri: redirectUri,
    }),
  })
  if (!tok.ok) throw new Error(providerError(tok.json, 'YouTube token exchange failed'))
  const accessToken = String(tok.json.access_token || '')
  if (!accessToken) throw new Error('YouTube returned no access token')
  const refreshToken = typeof tok.json.refresh_token === 'string' ? tok.json.refresh_token : undefined
  const expiresAt = expiryFromExpiresIn(Number(tok.json.expires_in) || undefined)

  // Identity: the authenticated channel id + title.
  const id = await fetchJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  const items = Array.isArray(id.json.items) ? (id.json.items as Record<string, unknown>[]) : []
  const first = items[0] as { id?: string; snippet?: { title?: string } } | undefined
  const externalAccountId = first?.id || 'youtube'
  const displayName = first?.snippet?.title || null

  // Capture the scopes Google actually GRANTED (space-separated) so partial-consent
  // is detectable downstream; fall back to the requested list if absent.
  const granted =
    typeof tok.json.scope === 'string' && tok.json.scope.trim()
      ? tok.json.scope.trim().split(/\s+/)
      : SOCIAL_OAUTH_PROVIDERS.youtube.scopes

  return {
    envelope: { accessToken, refreshToken, expiresAt, tokenType: 'Bearer' },
    externalAccountId,
    displayName,
    scopes: granted,
  }
}

async function refreshYouTube(envelope: CredentialEnvelope, env: Env): Promise<CredentialEnvelope | null> {
  const cfg = providerConfig('youtube', env)
  const secret = providerClientSecret('youtube', env)
  if (!cfg.configured || !secret || !cfg.clientId || !envelope.refreshToken) return null
  const tok = await fetchJson(SOCIAL_OAUTH_PROVIDERS.youtube.tokenUrl, {
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

// ── Facebook Page (Meta) ──────────────────────────────────────────────────────
async function completeFacebook(code: string, redirectUri: string, env: Env): Promise<OAuthConnection> {
  const cfg = providerConfig('facebook_page', env)
  const secret = providerClientSecret('facebook_page', env)
  if (!cfg.configured || !secret || !cfg.clientId) throw new Error('Facebook OAuth is not configured')
  const base = 'https://graph.facebook.com/v21.0'

  // 1. Code → short-lived user token.
  const shortUrl = `${cfg.tokenUrl}?${new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: secret,
    redirect_uri: redirectUri,
    code,
  })}`
  const short = await fetchJson(shortUrl)
  if (!short.ok) throw new Error(providerError(short.json, 'Facebook token exchange failed'))
  const shortToken = String(short.json.access_token || '')
  if (!shortToken) throw new Error('Facebook returned no access token')

  // 2. Short-lived → long-lived user token (~60 days).
  const longUrl = `${base}/oauth/access_token?${new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: cfg.clientId,
    client_secret: secret,
    fb_exchange_token: shortToken,
  })}`
  const long = await fetchJson(longUrl)
  const longToken = long.ok ? String(long.json.access_token || shortToken) : shortToken

  // 3. Pick a managed Page; store the Page token (non-expiring when derived from a
  //    long-lived user token) as the credential.
  const pages = await fetchJson(`${base}/me/accounts?${new URLSearchParams({ access_token: longToken })}`)
  if (!pages.ok) throw new Error(providerError(pages.json, 'Could not list Facebook Pages'))
  const data = Array.isArray(pages.json.data) ? (pages.json.data as Record<string, unknown>[]) : []
  const page = data[0] as { id?: string; name?: string; access_token?: string } | undefined
  if (!page?.id || !page.access_token) {
    throw new Error('No Facebook Page is available on this account. Grant the app access to a Page and reconnect.')
  }

  // Capture the permissions actually GRANTED (status === 'granted') so partial-consent
  // is detectable; fall back to the requested list if the call fails.
  let granted = SOCIAL_OAUTH_PROVIDERS.facebook_page.scopes
  const perms = await fetchJson(`${base}/me/permissions?${new URLSearchParams({ access_token: longToken })}`)
  if (perms.ok && Array.isArray(perms.json.data)) {
    const rows = perms.json.data as { permission?: string; status?: string }[]
    const g = rows.filter((r) => r.status === 'granted' && r.permission).map((r) => r.permission as string)
    if (g.length) granted = g
  }

  return {
    envelope: { accessToken: page.access_token, expiresAt: null, tokenType: 'Bearer' },
    externalAccountId: page.id,
    displayName: page.name || null,
    scopes: granted,
  }
}

// ── Public surface ────────────────────────────────────────────────────────────
export async function completeOAuth(
  platform: OAuthPlatform,
  args: { code: string; redirectUri: string },
  env: Env = process.env as Env,
): Promise<OAuthConnection> {
  if (platform === 'youtube') return completeYouTube(args.code, args.redirectUri, env)
  return completeFacebook(args.code, args.redirectUri, env)
}

/** Refresh a credential when possible; returns null when the provider has no
 *  silent-refresh path (Facebook) or the refresh fails — caller marks expired. */
export async function refreshCredential(
  platform: OAuthPlatform,
  envelope: CredentialEnvelope,
  env: Env = process.env as Env,
): Promise<CredentialEnvelope | null> {
  if (platform === 'youtube') return refreshYouTube(envelope, env)
  return null
}

export interface HealthResult {
  ok: boolean
  displayName?: string | null
  error?: string
}

/** Live health check: does the stored token still authenticate? No secret is logged. */
export async function verifyIdentity(
  platform: OAuthPlatform,
  envelope: CredentialEnvelope,
  externalAccountId: string | null,
): Promise<HealthResult> {
  try {
    if (platform === 'youtube') {
      const r = await fetchJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { authorization: `Bearer ${envelope.accessToken}` },
      })
      if (!r.ok) return { ok: false, error: providerError(r.json, `YouTube check failed (${r.status})`) }
      const items = Array.isArray(r.json.items) ? (r.json.items as Record<string, unknown>[]) : []
      const first = items[0] as { snippet?: { title?: string } } | undefined
      return { ok: true, displayName: first?.snippet?.title ?? null }
    }
    const pageId = externalAccountId || 'me'
    const r = await fetchJson(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}?${new URLSearchParams({
        fields: 'name',
        access_token: envelope.accessToken,
      })}`,
    )
    if (!r.ok) return { ok: false, error: providerError(r.json, `Facebook check failed (${r.status})`) }
    return { ok: true, displayName: typeof r.json.name === 'string' ? r.json.name : null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Health check failed' }
  }
}
