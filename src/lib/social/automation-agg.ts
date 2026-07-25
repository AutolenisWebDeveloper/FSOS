// Social automation visibility aggregation (ADR-026, operational depth item 5). PURE
// + offline-testable. Rolls up the EXISTING AI-workforce records (agent_runs /
// agent_actions) for the two social workers into a traceability summary. This is a
// READ/observability view only — no orchestration, no new agent. Relative imports for
// the gate test.

export const SOCIAL_WORKER_KEYS = ['content_drafter', 'engagement_triager'] as const
export type SocialWorkerKey = (typeof SOCIAL_WORKER_KEYS)[number]

export interface RunRow {
  agent_key: string
  status: string | null
  confidence: number | null
  started_at: string | null
  error: string | null
}

export interface ActionRow {
  actor: string | null
  kind: string | null
  outcome: string | null
  created_at: string | null
}

export interface WorkerActivity {
  agentKey: string
  totalRuns: number
  lastRunAt: string | null
  lastStatus: string | null
  errorRuns: number
  /** Mean confidence across runs that reported one (null when none did). */
  avgConfidence: number | null
  actions: number
  /** Actions the worker flagged for extra human review (outcome contains "flagged"). */
  flaggedActions: number
}

function actorForKey(agentKey: string): string {
  return `agent:${agentKey}`
}

export function summarizeWorker(agentKey: string, runs: RunRow[], actions: ActionRow[]): WorkerActivity {
  const mine = runs.filter((r) => r.agent_key === agentKey)
  const myActions = actions.filter((a) => a.actor === actorForKey(agentKey))

  let lastRunAt: string | null = null
  let lastStatus: string | null = null
  for (const r of mine) {
    if (r.started_at && (!lastRunAt || r.started_at > lastRunAt)) {
      lastRunAt = r.started_at
      lastStatus = r.status
    }
  }

  const confidences = mine.map((r) => r.confidence).filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
  const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null

  return {
    agentKey,
    totalRuns: mine.length,
    lastRunAt,
    lastStatus,
    errorRuns: mine.filter((r) => r.status === 'errored' || !!r.error).length,
    avgConfidence,
    actions: myActions.length,
    flaggedActions: myActions.filter((a) => (a.outcome ?? '').includes('flagged')).length,
  }
}

export function summarizeSocialWorkers(runs: RunRow[], actions: ActionRow[]): Record<SocialWorkerKey, WorkerActivity> {
  return {
    content_drafter: summarizeWorker('content_drafter', runs, actions),
    engagement_triager: summarizeWorker('engagement_triager', runs, actions),
  }
}
