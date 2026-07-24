// Social OAuth core (ADR-026). PURE, offline-testable logic for the connect flow:
// provider configuration, the authorize-URL builder, signed CSRF state, and the
// encrypted credential envelope. No Next runtime, no DB, no network here — the
// network exchange lives in oauth-exchange.ts and the routes wire them together.
//
// SECURITY:
//   • Client secrets and token material NEVER reach the browser. providerConfig()
//     returns the public client id + scopes only; the secret accessor is separate
//     and server-only.
//   • The OAuth `state` is an HMAC-signed, expiring token — CSRF defense. It is
//     verified constant-time and bound to a per-request nonce cookie by the routes.
//   • The stored credential is a JSON envelope encrypted at rest via pgcrypto
//     (social_channel_set_secret); this module only serializes/parses it.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type OAuthPlatform = 'youtube' | 'facebook_page'

export interface OAuthProviderDef {
  platform: OAuthPlatform
  label: string
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  /** True when the provider issues a refresh_token we can silently exchange (Google).
   *  Facebook uses long-lived tokens (fb_exchange_token), not a refresh_token grant. */
  supportsRefresh: boolean
  clientIdEnv: string[]
  clientSecretEnv: string[]
  /** Extra authorize-endpoint params (e.g. Google offline access + consent). */
  extraAuthParams?: Record<string, string>
}

// The two platforms with a real, activated publish path (Slices 3 & 4) and an
// official OAuth. Instagram / LinkedIn / X / TikTok have no activated OAuth here.
export const SOCIAL_OAUTH_PROVIDERS: Record<OAuthPlatform, OAuthProviderDef> = {
  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
    supportsRefresh: true,
    clientIdEnv: ['SOCIAL_YOUTUBE_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_YOUTUBE_CLIENT_SECRET', 'YOUTUBE_OAUTH_CLIENT_SECRET'],
    extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  facebook_page: {
    platform: 'facebook_page',
    label: 'Facebook Page',
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list', 'read_insights'],
    supportsRefresh: false,
    clientIdEnv: ['SOCIAL_FACEBOOK_APP_ID', 'FACEBOOK_OAUTH_CLIENT_ID'],
    clientSecretEnv: ['SOCIAL_FACEBOOK_APP_SECRET', 'FACEBOOK_OAUTH_CLIENT_SECRET'],
  },
}

export const OAUTH_PLATFORMS = Object.keys(SOCIAL_OAUTH_PROVIDERS) as OAuthPlatform[]

/** httpOnly cookie holding the per-request nonce the callback binds the state to. */
export const SOCIAL_OAUTH_NONCE_COOKIE = 'social_oauth_nonce'

export function isOAuthPlatform(p: string): p is OAuthPlatform {
  return p === 'youtube' || p === 'facebook_page'
}

type Env = Record<string, string | undefined>

function firstEnv(names: string[], env: Env): string | undefined {
  for (const n of names) {
    const v = env[n]
    if (v && v.trim()) return v.trim()
  }
  return undefined
}

export interface ProviderConfig {
  platform: OAuthPlatform
  label: string
  configured: boolean
  clientId?: string
  scopes: string[]
  authorizeUrl: string
  tokenUrl: string
  supportsRefresh: boolean
  extraAuthParams: Record<string, string>
  /** Human reason when not configured (env vars to set). Never leaks the secret. */
  reason?: string
}

/** Public provider config (safe to surface to the UI). `configured` is true only
 *  when BOTH the client id and secret are present in the environment. */
export function providerConfig(platform: OAuthPlatform, env: Env = process.env as Env): ProviderConfig {
  const def = SOCIAL_OAUTH_PROVIDERS[platform]
  const clientId = firstEnv(def.clientIdEnv, env)
  const clientSecret = firstEnv(def.clientSecretEnv, env)
  const configured = !!clientId && !!clientSecret
  return {
    platform,
    label: def.label,
    configured,
    clientId,
    scopes: def.scopes,
    authorizeUrl: def.authorizeUrl,
    tokenUrl: def.tokenUrl,
    supportsRefresh: def.supportsRefresh,
    extraAuthParams: def.extraAuthParams ?? {},
    reason: configured
      ? undefined
      : `${def.label} OAuth is not configured for this environment — set ${def.clientIdEnv[0]} and ${def.clientSecretEnv[0]}.`,
  }
}

/** Server-only client-secret accessor. NEVER call this in client-facing code. */
export function providerClientSecret(platform: OAuthPlatform, env: Env = process.env as Env): string | undefined {
  return firstEnv(SOCIAL_OAUTH_PROVIDERS[platform].clientSecretEnv, env)
}

export function buildAuthorizeUrl(args: { config: ProviderConfig; redirectUri: string; state: string }): string {
  const { config, redirectUri, state } = args
  const u = new URL(config.authorizeUrl)
  u.searchParams.set('client_id', config.clientId ?? '')
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', config.scopes.join(' '))
  u.searchParams.set('state', state)
  for (const [k, v] of Object.entries(config.extraAuthParams)) u.searchParams.set(k, v)
  return u.toString()
}

// ── Signed CSRF state ────────────────────────────────────────────────────────
export interface OAuthState {
  platform: OAuthPlatform
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
  if (!parsed || !isOAuthPlatform(parsed.platform)) return null
  if (typeof parsed.nonce !== 'string' || typeof parsed.exp !== 'number') return null
  if (parsed.exp <= nowMs) return null
  return parsed
}

/** HMAC key for the OAuth state token — falls back to the token-encryption key so
 *  a single secret configures the whole social OAuth path in dev. */
export function socialOAuthStateKey(env: Env = process.env as Env): string {
  return (
    env.SOCIAL_OAUTH_STATE_KEY ||
    env.SOCIAL_TOKEN_KEY ||
    env.FSOS_SOCIAL_TOKEN_KEY ||
    'fsos-dev-social-oauth-state-change-me'
  )
}

// ── Credential envelope (encrypted at rest via pgcrypto) ─────────────────────
export interface CredentialEnvelope {
  accessToken: string
  refreshToken?: string
  /** ISO string; when present, drives refresh-before-publish. */
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

/** Parse a decrypted secret. Accepts the JSON envelope AND a legacy plain-string
 *  token (the pre-envelope shape the publisher used), so nothing breaks. */
export function parseCredential(secret: string | null | undefined): CredentialEnvelope | null {
  if (!secret) return null
  const s = secret.trim()
  if (!s) return null
  if (s.startsWith('{')) {
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
      return null
    } catch {
      // fall through and treat as a legacy plain token
    }
  }
  return { accessToken: s }
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

/** Compute an ISO expiry from an `expires_in` seconds value returned by a provider. */
export function expiryFromExpiresIn(expiresIn: number | undefined, nowMs: number = Date.now()): string | null {
  if (!expiresIn || !Number.isFinite(expiresIn) || expiresIn <= 0) return null
  return new Date(nowMs + expiresIn * 1000).toISOString()
}

/** Absolute app base URL (env-configurable) for building the OAuth redirect_uri. */
export function appBaseUrl(env: Env = process.env as Env): string {
  const raw =
    env.NEXT_PUBLIC_APP_URL ||
    env.APP_URL ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '') ||
    ''
  return raw.replace(/\/$/, '')
}

/** The exact redirect_uri for a platform — MUST match what is registered with the
 *  provider and be identical between the start and callback legs. */
export function oauthRedirectUri(platform: OAuthPlatform, origin: string): string {
  return `${origin.replace(/\/$/, '')}/api/social/oauth/${platform}/callback`
}
