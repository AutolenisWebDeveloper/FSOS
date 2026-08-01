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
  // Resume enrollments paused by a customer reply once §10 conditions are met (Slice 4).
  'resume-paused': async () => (await h()).resumePausedEnrollments(),
  // The AI workforce daily run — builds the prioritized outreach queue and dispatches
  // every enabled outreach agent up to its quota, all through the compliance gate.
  'workforce-orchestrator': async () => (await h()).workforceOrchestrator(),
  // 'agent-runner' is the durable runner primitive (jobs/agent-runner.ts); the
  // workforce-orchestrator job above is its first scheduled consumer. Alias kept so
  // the registered cron name continues to resolve.
  'agent-runner': async () => (await h()).workforceOrchestrator(),
  'data-quality': async () => (await h()).dataQuality(),
  // Life Conversion Campaign scheduler — advances the multi-channel 20-touch timeline,
  // rechecking eligibility before every touch and routing every send through the gate.
  'life-conversion-tick': async () => (await h()).lifeConversionTick(),
  // Life Conversion retry/dead-letter sweep (§20 observability parity). Hourly; fails soft until
  // migration 087 lands.
  'life-conversion-retry': async () => (await h()).lifeConversionRetry(),
  // Pipeline Win-Back Campaign scheduler — daily enrollment sweep + advances the multi-channel
  // 24-touch timeline, rechecking eligibility before every touch, all sends through the gate.
  'pipeline-winback-tick': async () => (await h()).pipelineWinbackTick(),
  // Pipeline Win-Back retry/dead-letter sweep (§20 observability parity). Hourly; fails soft until
  // migration 088 lands.
  'pipeline-winback-retry': async () => (await h()).pipelineWinbackRetry(),
  // Cross-Sell Life Campaign — daily eligibility+enrollment sweep, the 35-touch/180-day scheduler
  // tick, and the retry/dead-letter sweep. Every send routes through the gate; ticks are idempotent.
  'cross-sell-life-enroll': async () => (await h()).crossSellLifeEnroll(),
  'cross-sell-life-tick': async () => (await h()).crossSellLifeTick(),
  'cross-sell-life-retry': async () => (await h()).crossSellLifeRetry(),
  'backup-verify': async () => (await h()).backupVerify(),
}

export function isJob(name: string): name is keyof typeof JOBS {
  return Object.prototype.hasOwnProperty.call(JOBS, name)
}
