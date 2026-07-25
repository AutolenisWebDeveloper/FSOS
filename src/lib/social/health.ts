// Social platform health (ADR-026, item 4). DB layer over the pure aggregator. Reads
// connected channels, recent publish failures, and queue depth from the module's own
// records — no new tables — and returns an operational health view. Everything is
// FSOS-observed (token state, our publish attempts); rate-limit headroom and webhook
// delivery are surfaced honestly as inferred/not-tracked (§4.3) in the UI.

import { getDb, ConfigError } from '@/lib/supabase/client'
import { CHANNEL_COLUMNS, toChannelView, type ChannelRow } from './channel-view'
import { computeSocialHealth, type HealthChannel, type HealthFailure, type SocialHealthResult } from './health-agg'
import type { SocialPlatform } from './adapters/types'

export type LoadResult<T> = { ok: true; data: T } | { ok: false; kind: 'not_configured' | 'error'; message: string }

export interface RecentFailure extends HealthFailure {
  attempt: number
}

export interface SocialHealthView extends SocialHealthResult {
  recentFailures: RecentFailure[]
}

interface PublishLogRow {
  channel_id: string | null
  attempt: number
  failure_reason: string | null
  platform_response: { code?: string } | null
  created_at: string
}

export async function getSocialHealth(nowMs: number = Date.now()): Promise<LoadResult<SocialHealthView>> {
  try {
    const db = getDb()
    const [channelsRes, failuresRes, pendingRes, failedRes] = await Promise.all([
      db.from('social_channels').select(CHANNEL_COLUMNS).is('deleted_at', null).order('platform', { ascending: true }),
      db.from('social_publish_log').select('channel_id, attempt, failure_reason, platform_response, created_at').eq('outcome', 'failure').order('created_at', { ascending: false }).limit(50),
      db.from('social_schedule_entries').select('id', { count: 'exact', head: true }).eq('status', 'pending').is('deleted_at', null),
      db.from('social_schedule_entries').select('id', { count: 'exact', head: true }).eq('status', 'failed').is('deleted_at', null),
    ])
    if (channelsRes.error) return { ok: false, kind: 'error', message: channelsRes.error.message }
    if (failuresRes.error) return { ok: false, kind: 'error', message: failuresRes.error.message }

    const channelViews = ((channelsRes.data ?? []) as unknown as ChannelRow[]).map(toChannelView)
    const healthChannels: HealthChannel[] = channelViews.map((c) => ({
      platform: c.platform,
      status: c.status,
      hasCredential: c.has_credential,
      tokenExpiresAt: c.token_expires_at,
      lastError: c.last_error,
      lastVerifiedAt: c.last_verified_at,
      grantedScopes: c.scopes,
    }))

    // Map each failure's channel_id → platform (include deleted channels for history).
    const logRows = (failuresRes.data ?? []) as PublishLogRow[]
    const channelIds = [...new Set(logRows.map((r) => r.channel_id).filter((x): x is string => !!x))]
    const platformById = new Map<string, SocialPlatform>()
    if (channelIds.length) {
      const { data: chans } = await db.from('social_channels').select('id, platform').in('id', channelIds)
      for (const c of (chans ?? []) as { id: string; platform: SocialPlatform }[]) platformById.set(c.id, c.platform)
    }

    const recentFailures: RecentFailure[] = logRows.map((r) => ({
      platform: (r.channel_id && platformById.get(r.channel_id)) || 'unknown',
      code: r.platform_response?.code ?? null,
      reason: r.failure_reason,
      at: r.created_at,
      attempt: r.attempt,
    }))

    const queue = { pending: pendingRes.count ?? 0, failed: failedRes.count ?? 0 }
    const result = computeSocialHealth(healthChannels, recentFailures, queue, nowMs)
    return { ok: true, data: { ...result, recentFailures } }
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, kind: 'not_configured', message: e.message }
    return { ok: false, kind: 'error', message: e instanceof Error ? e.message : 'Failed to load health' }
  }
}
