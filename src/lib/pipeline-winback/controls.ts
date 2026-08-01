// src/lib/pipeline-winback/controls.ts
// Operational controls for the Pipeline Win-Back Campaign (§5a): submit-for-approval, enable,
// pause, resume, disable, emergency-stop, archive. Authorization uses the existing RBAC role-
// intersection (no bespoke permission system); every action writes the append-only audit_log
// with {prev, next, reason, actor}. Because ONLY an Active campaign dispatches (engine.canDispatch),
// a Disable/Emergency-Stop needs no per-channel teardown — flipping the state halts email, SMS,
// AI-conversation initiation, advisor-task generation, AND the enrollment sweep in one place
// (spec §5a Emergency Stop). Disable/Emergency-Stop also pauses active enrollments DISTINCTLY as
// paused_by_admin (kept apart from paused_for_conversation so §5a's resume options can tell them
// apart). No automatic catch-up on resume — the tick fires at most one due touch per day.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { canTransition, controlTargetState, type ControlAction } from './engine'
// Reuse the shared campaign-engine resume core (ADR-031 shared primitives) — the SAME
// no-catch-up algorithm the Life Conversion engine uses, fed Win-Back's own 28-touch plan.
import { planResume, kindForTouch, type ResumeBehavior, type ReplayPolicy } from '@/lib/life-campaign/resume'
import { computeTouchPlan } from './schedule'
import type { Role } from '@/lib/auth/rbac'

// Who may operate the campaign (§5a). Reuses existing roles; compliance/supervisor get
// visibility elsewhere but control actions are ops/admin/super/fsa.
export const CONTROL_ROLES: Role[] = ['admin', 'ops', 'super_admin', 'fsa']

export interface WinbackControlResult {
  ok: boolean
  error?: string
  from?: string
  to?: string
  enrollmentsPaused?: number
  enrollmentsResumed?: number
  enrollmentsRestarted?: number
  /** The resume strategy that actually applied (recorded in the audit diff). */
  resumeBehavior?: ResumeBehavior
  replayPolicy?: ReplayPolicy
}

const PAUSE_ACTIONS = new Set<ControlAction>(['disable', 'emergency_stop', 'pause'])
const RESUME_ACTIONS = new Set<ControlAction>(['enable', 'resume'])

export async function applyControl(input: {
  campaignId: string
  action: ControlAction
  actor: string
  reason?: string
  /** Optional per-action resume strategy override (§5a). Absent → the safe default:
   *  only_admin_paused + skip (resume in place, no catch-up). */
  resumeBehavior?: ResumeBehavior
  replayPolicy?: ReplayPolicy
}): Promise<WinbackControlResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  const { data: campaign } = await db.from('pipeline_winback_campaigns').select('id, status').eq('id', input.campaignId).maybeSingle()
  if (!campaign) return { ok: false, error: 'campaign_missing' }

  const from = campaign.status as string
  const to = controlTargetState(input.action)
  if (!canTransition(from, to)) return { ok: false, error: 'invalid_transition', from, to }

  await db.from('pipeline_winback_campaigns').update({ status: to, updated_at: nowISO }).eq('id', input.campaignId)

  const result: WinbackControlResult = { ok: true, from, to }

  // Disable / Emergency-Stop / Pause: pause active enrollments distinctly as admin-paused. A
  // reply-pause (paused_for_conversation) is intentionally left alone so it isn't confused with
  // a global pause on resume (§5a's four resume options depend on this distinction).
  if (PAUSE_ACTIONS.has(input.action)) {
    const { data: paused } = await db
      .from('pipeline_winback_enrollments')
      .update({ status: 'paused_by_admin', paused_at: nowISO, pause_reason: input.action, updated_at: nowISO })
      .eq('campaign_id', input.campaignId)
      .eq('status', 'active')
      .select('id')
    result.enrollmentsPaused = (paused ?? []).length
  }

  // Enable / Resume: apply the configured (or overridden) resume strategy. NO automatic catch-up —
  // touches that came due while paused are recorded Skipped and the cadence fast-forwards to the
  // next future touch (§5a); only the explicit replay policy re-fires a pending touch. Defaults are
  // the safe pair: only_admin_paused + skip.
  if (RESUME_ACTIONS.has(input.action)) {
    const behavior: ResumeBehavior = input.resumeBehavior ?? 'only_admin_paused'
    const replay: ReplayPolicy = input.replayPolicy ?? 'skip'
    result.resumeBehavior = behavior
    result.replayPolicy = replay
    if (behavior === 'only_new') {
      result.enrollmentsResumed = 0 // leave existing paused; only new enrollments proceed
    } else if (behavior === 'restart_day_1') {
      result.enrollmentsRestarted = await restartPausedFromDayOne(input.campaignId, nowISO)
    } else {
      // only_admin_paused | all_active — resume the admin-paused enrollments in place.
      result.enrollmentsResumed = await resumePausedNoCatchup(input.campaignId, replay, nowISO)
    }
  }

  await writeAudit({
    actor: input.actor,
    action: 'config.changed',
    entity: 'pipeline_winback_campaign',
    entityId: input.campaignId,
    diff: {
      control: input.action,
      prev: from,
      next: to,
      reason: input.reason ?? null,
      ...(result.enrollmentsPaused != null ? { enrollments_paused: result.enrollmentsPaused } : {}),
      ...(result.enrollmentsResumed != null ? { enrollments_resumed: result.enrollmentsResumed } : {}),
      ...(result.enrollmentsRestarted != null ? { enrollments_restarted: result.enrollmentsRestarted } : {}),
      ...(result.resumeBehavior ? { resume_behavior: result.resumeBehavior } : {}),
      ...(result.replayPolicy ? { replay_policy: result.replayPolicy } : {}),
    },
  })
  return result
}

/**
 * Resume admin-paused enrollments WITHOUT catch-up (§5a). For each, the shared planResume decides
 * which past-due touches to record Skipped and where the cadence resumes; we persist the skipped
 * execution rows (idempotent on (enrollment_id, touch_no)) and fast-forward the enrollment to the
 * next future touch — or complete it if none remains. The status guard keeps a concurrent control
 * from double-resuming a row.
 */
async function resumePausedNoCatchup(campaignId: string, replay: ReplayPolicy, nowISO: string): Promise<number> {
  const db = getDb()
  const today = nowISO.slice(0, 10)
  const { data: rows } = await db
    .from('pipeline_winback_enrollments')
    .select('id, baseline_date, current_touch_no')
    .eq('campaign_id', campaignId)
    .eq('status', 'paused_by_admin')
    .limit(5000)

  let resumed = 0
  for (const e of rows ?? []) {
    const timeline = computeTouchPlan(e.baseline_date as string)
    const decision = planResume({
      plan: timeline,
      currentTouchNo: e.current_touch_no as number,
      today,
      replay,
    })
    for (const touchNo of decision.skippedTouchNos) {
      await recordSkipped(db, e.id as string, kindForTouch(timeline, touchNo) ?? 'email', touchNo, nowISO)
    }
    const patch: Record<string, unknown> = {
      status: 'active',
      current_touch_no: decision.newCursor,
      resumed_at: nowISO,
      updated_at: nowISO,
    }
    if (decision.nextTouchAt) patch.next_touch_at = decision.nextTouchAt
    if (decision.complete) {
      patch.status = 'completed'
      patch.current_touch_no = timeline[timeline.length - 1]?.touch_no ?? e.current_touch_no
      patch.completed_at = nowISO
    }
    await db.from('pipeline_winback_enrollments').update(patch).eq('id', e.id).eq('status', 'paused_by_admin')
    resumed++
  }
  return resumed
}

/** Record a touch skipped on resume (no catch-up). Idempotent on (enrollment_id, touch_no). */
async function recordSkipped(db: ReturnType<typeof getDb>, enrollmentId: string, kind: string, touchNo: number, nowISO: string): Promise<void> {
  await db
    .from('pipeline_winback_executions')
    .insert({
      enrollment_id: enrollmentId,
      touch_no: touchNo,
      kind,
      status: 'skipped',
      detail: { reason: 'resume_no_catchup' },
      executed_at: nowISO,
    })
    .then(() => undefined, () => undefined)
}

/** Restart admin-paused enrollments from Day 1 (§5a resume option): reset the baseline to today and
 *  re-arm the first touch. Existing executions stay as immutable history. */
async function restartPausedFromDayOne(campaignId: string, nowISO: string): Promise<number> {
  const db = getDb()
  const baseline = nowISO.slice(0, 10)
  const firstDue = computeTouchPlan(baseline)[0].dueDate
  const { data: rows } = await db
    .from('pipeline_winback_enrollments')
    .update({
      status: 'active',
      baseline_date: baseline,
      current_touch_no: 0,
      next_touch_at: `${firstDue}T13:00:00.000Z`,
      resumed_at: nowISO,
      updated_at: nowISO,
    })
    .eq('campaign_id', campaignId)
    .eq('status', 'paused_by_admin')
    .select('id')
  return (rows ?? []).length
}
