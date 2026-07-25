// Social automation visibility (ADR-026, item 5). DB layer over the aggregator. A
// READ/traceability view of the EXISTING social AI workers (Content Drafter,
// Engagement Triager) and their kill-switch state — no new orchestration, no new
// agent. Reads agent_runs / agent_actions and the module's own content/engagement
// queues; the kill switch is READ here and CONTROLLED at /super/ai/policies.

import { getDb, ConfigError } from '@/lib/supabase/client'
import { gatewayEnabledFrom } from '@/lib/ai/kill-switch'
import { AGENT_ROSTER } from '@/lib/ai/roster'
import {
  summarizeSocialWorkers,
  SOCIAL_WORKER_KEYS,
  type RunRow,
  type ActionRow,
  type WorkerActivity,
} from './automation-agg'

export type LoadResult<T> = { ok: true; data: T } | { ok: false; kind: 'not_configured' | 'error'; message: string }

export interface WorkerView extends WorkerActivity {
  label: string
  mission: string
  triggers: string
  confidenceThreshold: number
  enabled: boolean
}

export interface RecentRun {
  agent_key: string
  status: string | null
  confidence: number | null
  started_at: string | null
}

export interface SocialAutomationView {
  gatewayEnabled: boolean
  workers: WorkerView[]
  recentRuns: RecentRun[]
  content: { awaitingReview: number; aiDrafted: number; humanWritten: number; totalDrafts: number }
  engagement: { unresolved: number; triaged: number; total: number }
}

const WORKER_LABELS: Record<string, string> = {
  content_drafter: 'Content Drafter',
  engagement_triager: 'Engagement Triager',
}

export async function getSocialAutomation(): Promise<LoadResult<SocialAutomationView>> {
  try {
    const db = getDb()
    const keys = [...SOCIAL_WORKER_KEYS]
    const actors = keys.map((k) => `agent:${k}`)

    const [policyRes, agentsRes, runsRes, actionsRes, contentRes, engagementRes] = await Promise.all([
      db.from('ai_policies').select('gateway_enabled').eq('id', 'global').maybeSingle(),
      db.from('ai_agents').select('key, enabled').in('key', keys),
      db.from('agent_runs').select('id, agent_key, status, confidence, started_at, error').in('agent_key', keys).order('started_at', { ascending: false }).limit(100),
      db.from('agent_actions').select('actor, kind, outcome, created_at').in('actor', actors).order('created_at', { ascending: false }).limit(200),
      db.from('social_content').select('status, author_kind').is('deleted_at', null).limit(2000),
      db.from('social_engagement').select('resolution_status').limit(2000),
    ])

    if (runsRes.error) return { ok: false, kind: 'error', message: runsRes.error.message }
    if (contentRes.error) return { ok: false, kind: 'error', message: contentRes.error.message }
    if (engagementRes.error) return { ok: false, kind: 'error', message: engagementRes.error.message }

    // Kill switch: global gateway (fail-closed on error, default-enabled when absent) +
    // per-agent enabled flag.
    const gatewayEnabled = gatewayEnabledFrom(process.env.AI_GATEWAY_DISABLED === '1', policyRes.error ? null : policyRes.data, Boolean(policyRes.error))
    const enabledByKey = new Map<string, boolean>()
    for (const a of (agentsRes.data ?? []) as { key: string; enabled: boolean }[]) enabledByKey.set(a.key, a.enabled === true)

    const runs = (runsRes.data ?? []) as RunRow[]
    const actions = (actionsRes.data ?? []) as ActionRow[]
    const summaries = summarizeSocialWorkers(runs, actions)

    const workers: WorkerView[] = keys.map((k) => {
      const def = AGENT_ROSTER[k]
      return {
        ...summaries[k],
        label: WORKER_LABELS[k] ?? k,
        mission: def?.mission ?? '',
        triggers: def?.triggers ?? '',
        confidenceThreshold: def?.confidenceThreshold ?? 0,
        // Default-enabled when no explicit row exists (mirrors the gateway default).
        enabled: enabledByKey.has(k) ? enabledByKey.get(k)! : true,
      }
    })

    const contentRows = (contentRes.data ?? []) as { status: string; author_kind: string }[]
    const content = {
      awaitingReview: contentRows.filter((c) => c.status === 'IN_REVIEW').length,
      aiDrafted: contentRows.filter((c) => c.author_kind === 'ai').length,
      humanWritten: contentRows.filter((c) => c.author_kind === 'human').length,
      totalDrafts: contentRows.length,
    }

    const engRows = (engagementRes.data ?? []) as { resolution_status: string }[]
    const engagement = {
      unresolved: engRows.filter((e) => e.resolution_status === 'unmatched').length,
      triaged: engRows.filter((e) => e.resolution_status === 'triaged').length,
      total: engRows.length,
    }

    const recentRuns: RecentRun[] = runs.slice(0, 15).map((r) => ({ agent_key: r.agent_key, status: r.status, confidence: r.confidence, started_at: r.started_at }))

    return { ok: true, data: { gatewayEnabled, workers, recentRuns, content, engagement } }
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, kind: 'not_configured', message: e.message }
    return { ok: false, kind: 'error', message: e instanceof Error ? e.message : 'Failed to load automation' }
  }
}
