// src/lib/life-campaign/controls.ts
// Operational controls for the Life Conversion Campaign (§4b): enable, pause, resume, disable,
// emergency-stop, archive, submit-for-approval. Authorization is enforced with the existing
// RBAC role-intersection (no bespoke permission system); every action writes the append-only
// audit_log with {prev, next, reason, actor}. Because ONLY an Active campaign dispatches
// (states.canDispatch), a Disable/Emergency-Stop needs no per-channel teardown — flipping the
// state halts email, SMS, AI-conversation initiation, advisor-task generation, and enrollment
// in one place. Disable/Emergency-Stop also pauses active enrollments (distinctly, as
// paused_by_admin) and surfaces the deadline-exposure this deadline-sensitive campaign risks.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { canTransition, controlTargetState, type ControlAction } from './states'
import { planResume, kindForTouch, type ResumeBehavior, type ReplayPolicy } from './resume'
import { computeTouchPlan } from './schedule'
import type { Role } from '@/lib/auth/rbac'

// Who may operate the campaign (§4b). Reuses existing roles; compliance/supervisor get
// visibility elsewhere but control actions are ops/admin/super (agency_owner not applicable
// to this FSA-owned campaign).
export const CONTROL_ROLES: Role[] = ['admin', 'ops', 'super_admin', 'fsa']

export interface ControlResult {
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
  deadlineExposure?: DeadlineExposure
}

export interface DeadlineExposure {
  /** Active enrollments whose verified conversion deadline falls within the exposure horizon. */
  atRisk: number
  horizonDays: number
}

const PAUSE_ACTIONS = new Set<ControlAction>(['disable', 'emergency_stop', 'pause'])
const RESUME_ACTIONS = new Set<ControlAction>(['enable', 'resume'])

export async function applyControl(input: {
  campaignId: string
  action: ControlAction
  actor: string
  reason?: string
  /** Optional per-action resume strategy override (§4b). Absent → the safe default:
   *  only_admin_paused + skip (resume in place, no catch-up). */
  resumeBehavior?: ResumeBehavior
  replayPolicy?: ReplayPolicy
}): Promise<ControlResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  const { data: campaign } = await db.from('life_campaigns').select('id, status').eq('id', input.campaignId).maybeSingle()
  if (!campaign) return { ok: false, error: 'campaign_missing' }

  const from = campaign.status as string
  const to = controlTargetState(input.action)
  if (!canTransition(from, to)) return { ok: false, error: 'invalid_transition', from, to }

  await db.from('life_campaigns').update({ status: to, updated_at: nowISO }).eq('id', input.campaignId)

  const result: ControlResult = { ok: true, from, to }

  // Disable / Emergency-Stop / Pause: pause active enrollments distinctly as admin-paused.
  if (PAUSE_ACTIONS.has(input.action)) {
    const { data: paused } = await db
      .from('life_campaign_enrollments')
      .update({ status: 'paused_by_admin', paused_at: nowISO, pause_reason: input.action, updated_at: nowISO })
      .eq('campaign_id', input.campaignId)
      .eq('status', 'active')
      .select('id')
    result.enrollmentsPaused = (paused ?? []).length
    if (input.action === 'disable' || input.action === 'emergency_stop') {
      result.deadlineExposure = await deadlineExposure(input.campaignId, 30)
    }
  }

  // Enable / Resume: apply the configured (or overridden) resume strategy. NO automatic catch-up —
  // touches that came due while paused are recorded Skipped and the cadence fast-forwards to the
  // next future touch (§4b); only the explicit replay policy re-fires a pending touch. Defaults are
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
    entity: 'life_campaign',
    entityId: input.campaignId,
    diff: { control: input.action, prev: from, next: to, reason: input.reason ?? null, ...toExposureDiff(result) },
  })
  return result
}

function toExposureDiff(r: ControlResult): Record<string, unknown> {
  const d: Record<string, unknown> = {}
  if (r.enrollmentsPaused != null) d.enrollments_paused = r.enrollmentsPaused
  if (r.enrollmentsResumed != null) d.enrollments_resumed = r.enrollmentsResumed
  if (r.enrollmentsRestarted != null) d.enrollments_restarted = r.enrollmentsRestarted
  // Which resume strategy actually ran — explains in the audit trail why touches were skipped vs replayed.
  if (r.resumeBehavior) d.resume_behavior = r.resumeBehavior
  if (r.replayPolicy) d.replay_policy = r.replayPolicy
  if (r.deadlineExposure) d.deadline_exposure = r.deadlineExposure
  return d
}

/**
 * Resume admin-paused enrollments WITHOUT catch-up. For each, the pure planResume decides which
 * past-due touches to record Skipped and where the cadence resumes; we persist the skipped
 * execution rows (idempotent on (enrollment_id, touch_no)) and fast-forward the enrollment to the
 * next future touch — or complete it if none remains. The status guard (`.eq('status',
 * 'paused_by_admin')`) keeps a concurrent control from double-resuming a row.
 */
async function resumePausedNoCatchup(campaignId: string, replay: ReplayPolicy, nowISO: string): Promise<number> {
  const db = getDb()
  const today = nowISO.slice(0, 10)
  const { data: rows } = await db
    .from('life_campaign_enrollments')
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
    await db.from('life_campaign_enrollments').update(patch).eq('id', e.id).eq('status', 'paused_by_admin')
    resumed++
  }
  return resumed
}

/** Record a touch that was skipped on resume (no catch-up). Idempotent on (enrollment_id,
 *  touch_no) — a re-run of resume never double-writes the skip. */
async function recordSkipped(db: ReturnType<typeof getDb>, enrollmentId: string, kind: string, touchNo: number, nowISO: string): Promise<void> {
  await db
    .from('life_campaign_executions')
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

/** Restart admin-paused enrollments from Day 1 (§4b resume option): reset the baseline to today
 *  and re-arm the first touch. Existing executions stay as immutable history. */
async function restartPausedFromDayOne(campaignId: string, nowISO: string): Promise<number> {
  const db = getDb()
  const baseline = nowISO.slice(0, 10)
  const firstDue = computeTouchPlan(baseline)[0].dueDate
  const { data: rows } = await db
    .from('life_campaign_enrollments')
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

/** Count active enrollments whose verified deadline lands within `horizonDays` — the outage
 *  risk warning §4b requires before an operator disables/emergency-stops this campaign. */
export async function deadlineExposure(campaignId: string, horizonDays: number): Promise<DeadlineExposure> {
  const db = getDb()
  const horizon = new Date(Date.now() + horizonDays * 86400000).toISOString().slice(0, 10)
  const { count } = await db
    .from('life_campaign_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['active', 'paused_by_admin', 'paused_for_conversation'])
    .not('conversion_deadline', 'is', null)
    .lte('conversion_deadline', horizon)
  return { atRisk: count ?? 0, horizonDays }
}
