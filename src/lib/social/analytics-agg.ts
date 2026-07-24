// Pure social-analytics aggregation (ADR-026, Slice 6). No data-access imports, so
// it is unit-testable in isolation. Keeps platform-reported metrics distinct from
// FSOS-attributed outcomes (the latter live in analytics.ts's service layer).

import { PLATFORM_LABELS } from './labels'
import type { SocialPlatform } from './adapters/types'

export interface SnapshotRow {
  platform: SocialPlatform
  metrics: Record<string, unknown>
  captured_at: string
}

export interface PlatformMetrics {
  platform: SocialPlatform
  label: string
  followers: number | null
  reach: number
  impressions: number
  engagements: number
  clicks: number
  capturedAt: string | null
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : 0
  return Number.isFinite(n) ? n : 0
}

// Fold snapshots into one row per platform. followers takes the LATEST snapshot's
// value (a level, not a sum); reach/impressions/engagements/clicks sum across the
// window (flows). followers stays null when never reported so the UI shows "—".
export function aggregatePlatformMetrics(snapshots: SnapshotRow[]): PlatformMetrics[] {
  const byPlatform = new Map<SocialPlatform, PlatformMetrics>()
  const ordered = [...snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at))
  for (const s of ordered) {
    const m = s.metrics || {}
    const cur =
      byPlatform.get(s.platform) ??
      ({
        platform: s.platform,
        label: PLATFORM_LABELS[s.platform] ?? s.platform,
        followers: null,
        reach: 0,
        impressions: 0,
        engagements: 0,
        clicks: 0,
        capturedAt: null,
      } as PlatformMetrics)
    cur.reach += num(m.reach)
    cur.impressions += num(m.impressions)
    cur.engagements += num(m.engagements ?? m.engagement)
    cur.clicks += num(m.clicks ?? m.click_throughs)
    const f = m.followers ?? m.follower_count
    if (f !== undefined && f !== null) cur.followers = num(f)
    cur.capturedAt = s.captured_at
    byPlatform.set(s.platform, cur)
  }
  return [...byPlatform.values()].sort((a, b) => a.label.localeCompare(b.label))
}
