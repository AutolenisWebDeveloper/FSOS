// src/lib/district-nurture/controls.ts
// Operational controls for the District Agent FS Nurture Campaign (ADR-038): submit, enable,
// pause, resume, disable, emergency-stop, archive. Authorization uses the existing RBAC role
// intersection; every action writes the append-only audit_log with {prev, next, reason, actor}.
// Only an Active campaign dispatches (engine.canDispatch), so a Disable/Emergency-Stop halts the
// enrollment sweep and every touch by flipping one state. No automatic catch-up on resume — the
// tick fires at most one due touch per day. Reuses the shared no-catch-up resume core.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { canTransition, controlTargetState, type ControlAction } from './engine'
import { planResume, kindForTouch, type ResumeBehavior, type ReplayPolicy } from '@/lib/life-campaign/resume'
import { computeTouchPlan } from './schedule'
import type { Role } from '@/lib/auth/rbac'

export const CONTROL_ROLES: Role[] = ['admin', 'ops', 'super_admin', 'fsa']

export interface NurtureControlResult {
  ok: boolean
  error?: string
  from?: string
  to?: string
  enrollmentsPaused?: number
  enrollmentsResumed?: number
  enrollmentsRestarted?: number
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
  resumeBehavior?: ResumeBehavior
  replayPolicy?: ReplayPolicy
}): Promise<NurtureControlResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  const { data: campaign } = await db.from('district_nurture_campaigns').select('id, status').eq('id', input.campaignId).maybeSingle()
  if (!campaign) return { ok: false, error: 'campaign_missing' }

  const from = campaign.status as string
  const to = controlTargetState(input.action)
  if (!canTransition(from, to)) return { ok: false, error: 'invalid_transition', from, to }

  await db.from('district_nurture_campaigns').update({ status: to, updated_at: nowISO }).eq('id', input.campaignId)

  const result: NurtureControlResult = { ok: true, from, to }

  if (PAUSE_ACTIONS.has(input.action)) {
    const { data: paused } = await db
      .from('district_nurture_enrollments')
      .update({ status: 'paused_by_admin', paused_at: nowISO, pause_reason: input.action, updated_at: nowISO })
      .eq('campaign_id', input.campaignId)
      .eq('status', 'active')
      .select('id')
    result.enrollmentsPaused = (paused ?? []).length
  }

  if (RESUME_ACTIONS.has(input.action)) {
    const behavior: ResumeBehavior = input.resumeBehavior ?? 'only_admin_paused'
    const replay: ReplayPolicy = input.replayPolicy ?? 'skip'
    result.resumeBehavior = behavior
    result.replayPolicy = replay
    if (behavior === 'only_new') {
      result.enrollmentsResumed = 0
    } else if (behavior === 'restart_day_1') {
      result.enrollmentsRestarted = await restartPausedFromDayOne(input.campaignId, nowISO)
    } else {
      result.enrollmentsResumed = await resumePausedNoCatchup(input.campaignId, replay, nowISO)
    }
  }

  await writeAudit({
    actor: input.actor,
    action: 'config.changed',
    entity: 'district_nurture_campaign',
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

async function resumePausedNoCatchup(campaignId: string, replay: ReplayPolicy, nowISO: string): Promise<number> {
  const db = getDb()
  const today = nowISO.slice(0, 10)
  const { data: rows } = await db
    .from('district_nurture_enrollments')
    .select('id, baseline_date, current_touch_no')
    .eq('campaign_id', campaignId)
    .eq('status', 'paused_by_admin')
    .limit(5000)

  let resumed = 0
  for (const e of rows ?? []) {
    const timeline = computeTouchPlan(e.baseline_date as string)
    const decision = planResume({ plan: timeline, currentTouchNo: e.current_touch_no as number, today, replay })
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
    await db.from('district_nurture_enrollments').update(patch).eq('id', e.id).eq('status', 'paused_by_admin')
    resumed++
  }
  return resumed
}

async function recordSkipped(db: ReturnType<typeof getDb>, enrollmentId: string, kind: string, touchNo: number, nowISO: string): Promise<void> {
  await db
    .from('district_nurture_executions')
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

async function restartPausedFromDayOne(campaignId: string, nowISO: string): Promise<number> {
  const db = getDb()
  const baseline = nowISO.slice(0, 10)
  const firstDue = computeTouchPlan(baseline)[0].dueDate
  const { data: rows } = await db
    .from('district_nurture_enrollments')
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
