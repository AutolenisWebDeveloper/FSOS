// Account onboarding model (ADR-026, operational depth item 1). PURE + offline-
// testable. Encodes the guided connection flow's two knowledge sources:
//   1. WHAT each requested OAuth scope is and WHY FSOS needs it (shown before the
//      user leaves for the provider — informed consent, no surprise permissions);
//   2. the honest CONNECTION STATE of a channel and the single clear next action for
//      it — so every unhappy path (denied, partial scopes, expired, revoked, error,
//      not-approved) resolves to a state with a next step, never a crash.
// Reuses the OAuth provider scope lists (no second source of truth) and the channel
// view shape. Relative imports so the offline gate tests compile with plain tsc.

import { SOCIAL_OAUTH_PROVIDERS, type OAuthPlatform } from './oauth'
import type { SocialPlatform } from './adapters/types'

export type SocialCapability = 'publish' | 'read_engagement' | 'read_analytics'

export interface ScopeExplanation {
  scope: string
  /** Plain-language name of the permission. */
  label: string
  /** Why FSOS requests it — what it enables, in the user's terms. */
  why: string
  /** Which FSOS capability this scope unlocks. */
  capability: SocialCapability
}

// Per-platform, per-scope explanations. Keyed to the EXACT scope strings the OAuth
// provider config requests, so the consent screen can never drift from what is asked.
const SCOPE_EXPLANATIONS: Record<OAuthPlatform, Record<string, Omit<ScopeExplanation, 'scope'>>> = {
  youtube: {
    'https://www.googleapis.com/auth/youtube.upload': {
      label: 'Upload videos',
      why: 'Lets FSOS publish an approved video to your channel when you schedule it. FSOS never uploads without your approval.',
      capability: 'publish',
    },
    'https://www.googleapis.com/auth/youtube.readonly': {
      label: 'Read channel info & stats',
      why: 'Reads your channel identity and post performance so FSOS can confirm the connection and show analytics. Read-only.',
      capability: 'read_analytics',
    },
  },
  facebook_page: {
    pages_manage_posts: {
      label: 'Publish Page posts',
      why: 'Lets FSOS publish an approved post to your Page when you schedule it. Applies to your Page only — never a personal profile.',
      capability: 'publish',
    },
    pages_read_engagement: {
      label: 'Read Page engagement',
      why: 'Reads comments and reactions on your Page posts so FSOS can route engagement to the right contact.',
      capability: 'read_engagement',
    },
    pages_show_list: {
      label: 'See which Pages you manage',
      why: 'Lets FSOS list the Pages you manage so you can connect the right one.',
      capability: 'publish',
    },
    read_insights: {
      label: 'Read Page insights',
      why: 'Reads post reach and performance so FSOS can show analytics. Read-only.',
      capability: 'read_analytics',
    },
  },
}

export function requiredScopes(platform: OAuthPlatform): string[] {
  return SOCIAL_OAUTH_PROVIDERS[platform].scopes
}

export function explainScopes(platform: OAuthPlatform): ScopeExplanation[] {
  const map = SCOPE_EXPLANATIONS[platform]
  return requiredScopes(platform).map((scope) => ({
    scope,
    label: map[scope]?.label ?? scope,
    why: map[scope]?.why ?? 'Requested by the platform to enable publishing and analytics.',
    capability: map[scope]?.capability ?? 'publish',
  }))
}

// Distinct FSOS capabilities the requested scopes unlock (for the "what you'll be able
// to do" summary on the consent screen).
export function grantedCapabilities(platform: OAuthPlatform): SocialCapability[] {
  const caps = new Set<SocialCapability>()
  for (const e of explainScopes(platform)) caps.add(e.capability)
  return [...caps]
}

// Case-insensitive scope comparison; a granted set that omits any required scope is a
// PARTIAL grant. Providers can return granted scopes in different forms, so normalize.
export function missingScopes(required: string[], granted: string[] | null | undefined): string[] {
  const have = new Set((granted ?? []).map((s) => s.toLowerCase().trim()))
  return required.filter((r) => !have.has(r.toLowerCase().trim()))
}

// ── Connection state model ───────────────────────────────────────────────────
export type ConnectionState =
  | 'not_connected'
  | 'healthy'
  | 'expiring'
  | 'expired'
  | 'revoked'
  | 'error'
  | 'partial_scopes'

export interface ConnectionStatus {
  state: ConnectionState
  tone: 'success' | 'warning' | 'error' | 'neutral'
  /** One-line honest description of where the connection stands. */
  summary: string
  /** The single clear next action, or null when nothing is needed (healthy). */
  nextAction: { label: string; kind: 'connect' | 'reconnect' } | null
}

export interface ChannelStateInput {
  platform: SocialPlatform
  status: string
  hasCredential: boolean
  tokenExpiresAt: string | null
  lastError: string | null
  grantedScopes: string[] | null
  /** Days-before-expiry that counts as "expiring soon". */
}

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000

// Resolve a channel to exactly one honest state with a next action. Precedence:
// not-connected → revoked → error → expired → partial-scopes → expiring → healthy.
export function connectionStatus(input: ChannelStateInput, nowMs: number = Date.now()): ConnectionStatus {
  const reconnect = { label: 'Reconnect', kind: 'reconnect' as const }

  if (!input.hasCredential || input.status === 'not_configured') {
    return { state: 'not_connected', tone: 'neutral', summary: 'Not connected yet.', nextAction: { label: 'Connect', kind: 'connect' } }
  }
  if (input.status === 'revoked') {
    return { state: 'revoked', tone: 'error', summary: 'Access was revoked on the platform. Reconnect to resume publishing.', nextAction: reconnect }
  }
  if (input.status === 'error' || input.lastError) {
    return { state: 'error', tone: 'error', summary: input.lastError || 'The last check failed. Reconnect to restore the connection.', nextAction: reconnect }
  }

  const expMs = input.tokenExpiresAt ? Date.parse(input.tokenExpiresAt) : NaN
  if (Number.isFinite(expMs) && expMs <= nowMs) {
    return { state: 'expired', tone: 'error', summary: 'The access token expired. Reconnect to resume publishing.', nextAction: reconnect }
  }
  if (input.status === 'expired') {
    return { state: 'expired', tone: 'error', summary: 'The connection expired. Reconnect to resume publishing.', nextAction: reconnect }
  }

  const isOAuth = input.platform === 'youtube' || input.platform === 'facebook_page'
  if (isOAuth) {
    const missing = missingScopes(requiredScopes(input.platform as OAuthPlatform), input.grantedScopes)
    if (missing.length) {
      return {
        state: 'partial_scopes',
        tone: 'warning',
        summary: `Some permissions were not granted (${missing.length} missing). Reconnect and allow all requested permissions.`,
        nextAction: reconnect,
      }
    }
  }

  if (Number.isFinite(expMs) && expMs - nowMs <= EXPIRING_SOON_MS) {
    const days = Math.max(1, Math.ceil((expMs - nowMs) / (24 * 60 * 60 * 1000)))
    return { state: 'expiring', tone: 'warning', summary: `Access expires in ~${days} day${days === 1 ? '' : 's'}. Reconnect soon to avoid interruption.`, nextAction: reconnect }
  }

  return { state: 'healthy', tone: 'success', summary: 'Connected and healthy.', nextAction: null }
}
