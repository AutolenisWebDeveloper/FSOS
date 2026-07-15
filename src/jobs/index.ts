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

// The concrete P1 job logic. Imported lazily so this registry stays importable
// (and the cron route resolvable) without eagerly loading Supabase. All client-
// facing output routes through lib/comms/dispatcher.ts (the gate).
async function h() {
  return import('./handlers')
}

// The canonical job list from routes.md + data-api-map §2. All client-facing
// output routes through the dispatcher/gate; detection jobs create tasks/escalations.
export const JOBS: Record<string, JobHandler> = {
  'renewal-watch': async () => (await h()).renewalWatch(),
  'conversion-watch': async () => (await h()).conversionWatch(),
  'xdate-watch': async () => (await h()).xdateWatch(),
  'referral-sla': async () => (await h()).referralSla(),
  'agency-dormancy': async () => (await h()).agencyDormancy(),
  'cross-sell-scan': async () => (await h()).crossSellScan(),
  'commission-reconcile': async () => (await h()).commissionReconcile(),
  'campaign-dispatch': async () => (await h()).campaignDispatch(),
  'agent-runner': placeholder('agent-runner'),
  'data-quality': async () => (await h()).dataQuality(),
  'backup-verify': async () => (await h()).backupVerify(),
}

export function isJob(name: string): name is keyof typeof JOBS {
  return Object.prototype.hasOwnProperty.call(JOBS, name)
}
