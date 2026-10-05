// src/lib/ops/automation-status.ts
// PURE read model: what an automation's LAST RECORDED RUN says, from execution evidence (job_runs)
// rather than configuration flags. The campaign health panels coloured every successful run amber
// and never showed a failure as one (audit I-06), and other surfaces called a flag "working"
// (I-11). job_runs.status is 'running' | 'completed' | 'errored' (runIdempotent); failures are now
// recorded (J-07), so they can be shown.

export type RunState = 'succeeded' | 'failed' | 'timed_out' | 'running' | 'stale' | 'none'

export interface RunEvidence {
  status: string
  started_at: string
  finished_at?: string | null
}

/**
 * A `running` claim older than this was hard-killed (serverless timeout / OOM) before it could
 * record an outcome. runIdempotent reclaims it after the same lease (JOB_LEASE_MS re-exports this).
 */
export const RUN_LEASE_MS = 15 * 60 * 1000

/** A daily job with no successful run in this window is stale (one day + a 2h margin). */
export const DAILY_STALE_MS = 26 * 3600 * 1000

/** Classify the latest run of a job. `staleAfterMs` is the job's expected cadence plus margin. */
export function runState(run: RunEvidence | null | undefined, nowMs: number, staleAfterMs = DAILY_STALE_MS): RunState {
  if (!run) return 'none'
  if (run.status === 'errored') return 'failed'
  // Follow-up R17a: a run still 'running' past its lease died without recording an outcome; it
  // used to show as Running forever.
  if (run.status === 'running') {
    const started = Date.parse(run.started_at)
    return Number.isFinite(started) && nowMs - started > RUN_LEASE_MS ? 'timed_out' : 'running'
  }
  const at = Date.parse(run.finished_at ?? run.started_at)
  if (run.status !== 'completed' && run.status !== 'ok' && run.status !== 'success') return 'failed'
  if (!Number.isFinite(at) || nowMs - at > staleAfterMs) return 'stale'
  return 'succeeded'
}

export const RUN_STATE_LABEL: Record<RunState, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  timed_out: 'Timed out',
  running: 'Running',
  stale: 'No recent run',
  none: 'No run recorded',
}

/** Design-system dot class for a run state (DESIGN.md status tokens). */
export const RUN_STATE_DOT: Record<RunState, string> = {
  succeeded: 'bg-status-won',
  failed: 'bg-status-lost',
  timed_out: 'bg-status-lost',
  running: 'bg-status-pending',
  stale: 'bg-status-pending',
  none: 'bg-muted-foreground/40',
}
