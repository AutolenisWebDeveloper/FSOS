// src/jobs/index.ts
// Background-job registry (routes.md "Background jobs / cron"). The durable runner
// (agent-runner.ts) + idempotency/retry (lib/jobs/runtime.ts) are the Foundation
// deliverables; the concrete job LOGIC (renewal-watch, conversion-watch, …) is
// built in P1/P2. Each entry below is a clearly-labeled placeholder so the cron
// wiring resolves every registered name without silently doing nothing unlabeled.

export interface JobResult {
  ok: boolean
  note?: string
  handled?: number
}

export type JobHandler = () => Promise<JobResult>

function placeholder(name: string): JobHandler {
  return async () => ({ ok: true, note: `${name}: registered placeholder — logic implemented in P1/P2`, handled: 0 })
}

// The canonical job list from routes.md + data-api-map §2. All client-facing
// output MUST route through lib/comms/dispatcher.ts when these are implemented.
export const JOBS: Record<string, JobHandler> = {
  'renewal-watch': placeholder('renewal-watch'),
  'conversion-watch': placeholder('conversion-watch'),
  'xdate-watch': placeholder('xdate-watch'),
  'referral-sla': placeholder('referral-sla'),
  'agency-dormancy': placeholder('agency-dormancy'),
  'cross-sell-scan': placeholder('cross-sell-scan'),
  'commission-reconcile': placeholder('commission-reconcile'),
  'campaign-dispatch': placeholder('campaign-dispatch'),
  'agent-runner': placeholder('agent-runner'),
  'data-quality': placeholder('data-quality'),
  'backup-verify': placeholder('backup-verify'),
}

export function isJob(name: string): name is keyof typeof JOBS {
  return Object.prototype.hasOwnProperty.call(JOBS, name)
}
