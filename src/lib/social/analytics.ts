// Social analytics (ADR-026, Slice 6). Aggregates platform-reported metrics from
// social_analytics_snapshots and FSOS-attributed outcomes from the module's own
// records. These are kept DISTINCT: platform-reported numbers come from a platform
// API (source), FSOS-attributed outcomes are what the module can prove it caused.
//
// There is NO new dashboard: the top-line social counters surface as widgets in the
// existing Executive Dashboard catalog (lib/analytics/catalog.ts); this module's
// /app/social/analytics view reuses the existing dashboard archetypes.

import { getDb } from '@/lib/supabase/client'
import { aggregatePlatformMetrics, type PlatformMetrics, type SnapshotRow } from './analytics-agg'

export type { PlatformMetrics, SnapshotRow }
export { aggregatePlatformMetrics }

export interface AttributedOutcomes {
  published: number
  leads: number
  opportunities: number
  tasks: number
  engagementTotal: number
}

export interface SocialAnalytics {
  platformReported: PlatformMetrics[]
  attributed: AttributedOutcomes
  hasPlatformData: boolean
}

export type LoadResult<T> = { ok: true; data: T } | { ok: false; kind: 'not_configured' | 'error'; message: string }

// Load + aggregate. Attributed outcomes are what the module PROVABLY caused:
// posts it published, and leads/opportunities/tasks created from social engagement.
export async function getSocialAnalytics(): Promise<LoadResult<SocialAnalytics>> {
  const db = getDb()
  try {
    const [snaps, published, engagement] = await Promise.all([
      db.from('social_analytics_snapshots').select('platform, metrics, captured_at').order('captured_at', { ascending: true }).limit(1000),
      db.from('social_schedule_entries').select('id').eq('status', 'published').is('deleted_at', null),
      db.from('social_engagement').select('id, classification, linked_opportunity_id, linked_task_id'),
    ])

    if (snaps.error || published.error || engagement.error) {
      const msg = snaps.error?.message || published.error?.message || engagement.error?.message || 'query failed'
      return { ok: false, kind: 'error', message: msg }
    }

    const platformReported = aggregatePlatformMetrics((snaps.data ?? []) as SnapshotRow[])
    const eng = (engagement.data ?? []) as { classification: string | null; linked_opportunity_id: string | null; linked_task_id: string | null }[]
    const attributed: AttributedOutcomes = {
      published: (published.data ?? []).length,
      leads: eng.filter((e) => e.classification === 'lead').length,
      opportunities: eng.filter((e) => e.linked_opportunity_id).length,
      tasks: eng.filter((e) => e.linked_task_id).length,
      engagementTotal: eng.length,
    }
    return { ok: true, data: { platformReported, attributed, hasPlatformData: platformReported.length > 0 } }
  } catch (e) {
    // ConfigError → not_configured (mirrors the data-query layer).
    if (e && typeof e === 'object' && (e as { name?: string }).name === 'ConfigError') {
      return { ok: false, kind: 'not_configured', message: 'Database not configured' }
    }
    return { ok: false, kind: 'error', message: e instanceof Error ? e.message : 'Failed to load analytics' }
  }
}
