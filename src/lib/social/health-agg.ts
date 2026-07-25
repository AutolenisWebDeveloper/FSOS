// Social platform health aggregation (ADR-026, operational depth item 4). PURE +
// offline-testable. Turns connected channels + recent publish failures + queue counts
// into a per-platform operational health view — proactively surfacing token expiry
// BEFORE it breaks the publish queue (the failure mode to prevent). Reuses the item-1
// connectionStatus model (no second notion of "connected"). Relative imports for the
// gate test.

import { connectionStatus, type ConnectionState } from './onboarding'
import type { SocialPlatform } from './adapters/types'

export interface HealthChannel {
  platform: SocialPlatform
  status: string
  hasCredential: boolean
  tokenExpiresAt: string | null
  lastError: string | null
  lastVerifiedAt: string | null
  grantedScopes: string[] | null
}

export interface HealthFailure {
  platform: string
  code: string | null
  reason: string | null
  at: string
}

export interface QueueCounts {
  pending: number
  failed: number
}

export type OverallHealth = 'healthy' | 'degraded' | 'down' | 'idle'

export interface PlatformHealth {
  platform: SocialPlatform
  connected: boolean
  state: ConnectionState
  tone: 'success' | 'warning' | 'error' | 'neutral'
  summary: string
  tokenExpiresAt: string | null
  expiresInDays: number | null
  expiringSoon: boolean
  expired: boolean
  lastVerifiedAt: string | null
  recentFailures: number
  lastFailure: HealthFailure | null
  rateLimited: boolean
}

export interface SocialHealthResult {
  overall: OverallHealth
  platforms: PlatformHealth[]
  totalRecentFailures: number
  tokensExpiringSoon: number
  tokensExpired: number
  queue: QueueCounts
}

const DAY_MS = 24 * 60 * 60 * 1000
const EXPIRING_DAYS = 7

// Severity ordering so a platform with multiple channels reports its WORST channel.
const TONE_SEVERITY: Record<PlatformHealth['tone'], number> = { error: 3, warning: 2, neutral: 1, success: 0 }

export function computeSocialHealth(
  channels: HealthChannel[],
  failures: HealthFailure[],
  queue: QueueCounts,
  nowMs: number = Date.now(),
): SocialHealthResult {
  const failuresByPlatform = new Map<string, HealthFailure[]>()
  for (const f of failures) {
    const list = failuresByPlatform.get(f.platform) ?? []
    list.push(f)
    failuresByPlatform.set(f.platform, list)
  }

  // Group channels by platform; keep the WORST connection state per platform.
  const byPlatform = new Map<SocialPlatform, HealthChannel[]>()
  for (const c of channels) {
    const list = byPlatform.get(c.platform) ?? []
    list.push(c)
    byPlatform.set(c.platform, list)
  }

  const platforms: PlatformHealth[] = []
  for (const [platform, chans] of byPlatform.entries()) {
    let worst: PlatformHealth | null = null
    for (const c of chans) {
      const cs = connectionStatus(
        {
          platform: c.platform,
          status: c.status,
          hasCredential: c.hasCredential,
          tokenExpiresAt: c.tokenExpiresAt,
          lastError: c.lastError,
          grantedScopes: c.grantedScopes,
        },
        nowMs,
      )
      const expMs = c.tokenExpiresAt ? Date.parse(c.tokenExpiresAt) : NaN
      const expiresInDays = Number.isFinite(expMs) ? Math.floor((expMs - nowMs) / DAY_MS) : null
      const expired = expiresInDays != null && expiresInDays < 0
      const expiringSoon = expiresInDays != null && expiresInDays >= 0 && expiresInDays <= EXPIRING_DAYS
      const platFailures = failuresByPlatform.get(platform) ?? []
      const candidate: PlatformHealth = {
        platform,
        connected: c.hasCredential && c.status !== 'not_configured',
        state: cs.state,
        tone: cs.tone,
        summary: cs.summary,
        tokenExpiresAt: c.tokenExpiresAt,
        expiresInDays,
        expiringSoon,
        expired,
        lastVerifiedAt: c.lastVerifiedAt,
        recentFailures: platFailures.length,
        lastFailure: platFailures.slice().sort((a, b) => b.at.localeCompare(a.at))[0] ?? null,
        rateLimited: platFailures.some((f) => f.code === 'rate_limited'),
      }
      if (!worst || TONE_SEVERITY[candidate.tone] > TONE_SEVERITY[worst.tone]) worst = candidate
    }
    if (worst) platforms.push(worst)
  }

  platforms.sort((a, b) => TONE_SEVERITY[b.tone] - TONE_SEVERITY[a.tone] || a.platform.localeCompare(b.platform))

  const tokensExpired = platforms.filter((p) => p.expired).length
  const tokensExpiringSoon = platforms.filter((p) => p.expiringSoon).length
  const totalRecentFailures = failures.length

  let overall: OverallHealth
  if (platforms.length === 0 || !platforms.some((p) => p.connected)) {
    overall = 'idle'
  } else if (platforms.some((p) => p.tone === 'error')) {
    overall = 'down'
  } else if (platforms.some((p) => p.tone === 'warning') || totalRecentFailures > 0) {
    overall = 'degraded'
  } else {
    overall = 'healthy'
  }

  return { overall, platforms, totalRecentFailures, tokensExpiringSoon, tokensExpired, queue }
}
