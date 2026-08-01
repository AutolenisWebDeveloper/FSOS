// src/lib/cross-sell-life/controls.ts
// Operational controls for the Cross-Sell Life Campaign (§ Campaign Operational Controls): enable,
// pause, resume, disable, emergency-stop, archive, submit-for-approval — plus versioning (new
// immutable version), configurable resume behavior + replay policy, restart-enrollments, and
// settings updates. Authorization uses the existing RBAC role-intersection; EVERY action writes the
// append-only audit_log with {control, prev, next, reason, actor} (§ Permissions). Because ONLY an
// Active campaign dispatches (states.canDispatch), Disable/Emergency-Stop needs no per-channel
// teardown — flipping the state halts email, SMS, AI-conversation initiation, advisor-task
// generation, and enrollment in one place (the kill switch, §18).
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { canTransition, controlTargetState, interpretControlClaim, type ControlAction } from './states'
import { computeTouchPlan, deferToBusinessDay } from './schedule'
import type { Role } from '@/lib/auth/rbac'

export const CONTROL_ROLES: Role[] = ['admin', 'ops', 'super_admin', 'fsa']

export type ResumeBehavior = 'all_active' | 'only_admin_paused' | 'restart_day_1' | 'only_new'
export type ReplayPolicy = 'skip' | 'replay'

export interface ControlResult {
  ok: boolean
  error?: string
  from?: string
  to?: string
  enrollmentsPaused?: number
  enrollmentsResumed?: number
  enrollmentsRestarted?: number
}

const PAUSE_ACTIONS = new Set<ControlAction>(['disable', 'emergency_stop', 'pause'])
const RESUME_ACTIONS = new Set<ControlAction>(['enable', 'resume'])

export async function applyControl(input: {
  campaignId: string
  action: ControlAction
  actor: string
  reason?: string
  /** Optional per-action override of the campaign's configured resume behavior / replay policy. */
  resumeBehavior?: ResumeBehavior
  replayPolicy?: ReplayPolicy
}): Promise<ControlResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  const { data: campaign } = await db
    .from('xsell_life_campaigns')
    .select('id, status, resume_behavior, replay_policy, send_on_weekends, send_on_holidays, holiday_calendar')
    .eq('id', input.campaignId)
    .maybeSingle()
  if (!campaign) return { ok: false, error: 'campaign_missing' }

  const from = campaign.status as string
  const to = controlTargetState(input.action)
  if (!canTransition(from, to)) return { ok: false, error: 'invalid_transition', from, to }

  const patch: Record<string, unknown> = { status: to, updated_at: nowISO }
  if (input.action === 'enable' || input.action === 'resume') patch.activated_at = nowISO
  if (input.action === 'emergency_stop') {
    patch.emergency_stopped_at = nowISO
    patch.emergency_stopped_by = input.actor
  }
  if (input.action === 'archive') patch.archived_at = nowISO
  // Optimistic-concurrency compare-and-set: only flip the status if it is STILL `from` (D6/TOCTOU).
  // Two concurrent authorized POSTs both pass canTransition above; the predicate + rows-affected
  // check below lets exactly ONE win — the loser sees 0 rows and returns stale_state (→ 409) instead
  // of a second no-op "success" that would double-pause enrollments and write a misleading audit pair.
  const { data: claimed } = await db
    .from('xsell_life_campaigns')
    .update(patch)
    .eq('id', input.campaignId)
    .eq('status', from)
    .select('id')
  const claim = interpretControlClaim(from, to, (claimed ?? []).length)
  if (!claim.ok) return { ok: false, error: claim.error, from, to }

  const result: ControlResult = { ok: true, from, to }
  // Which resume strategy actually applied — recorded in the audit diff (D11). Null for non-resume.
  let appliedResumeBehavior: ResumeBehavior | null = null
  let appliedReplayPolicy: ReplayPolicy | null = null

  // Pause/Disable/Emergency-Stop: pause running enrollments distinctly as admin-paused so the
  // configurable resume behavior can tell them apart from reply-pauses (§ Resume Behavior). Runs
  // only for the WINNING claim (the compare-and-set committed above).
  if (PAUSE_ACTIONS.has(input.action)) {
    const { data: paused } = await db
      .from('xsell_life_campaign_enrollments')
      .update({ status: 'paused_by_admin', previous_status: 'running', paused_at: nowISO, pause_reason: input.action, updated_at: nowISO })
      .eq('campaign_id', input.campaignId)
      .eq('status', 'running')
      .select('id')
    result.enrollmentsPaused = (paused ?? []).length
  }

  // Enable/Resume: apply the configured (or overridden) resume behavior. No automatic catch-up:
  // missed touches are recorded as Skipped unless replay_policy='replay' (§ Resume Behavior).
  if (RESUME_ACTIONS.has(input.action)) {
    const behavior = (input.resumeBehavior ?? (campaign.resume_behavior as ResumeBehavior)) ?? 'only_admin_paused'
    const replay = (input.replayPolicy ?? (campaign.replay_policy as ReplayPolicy)) ?? 'skip'
    appliedResumeBehavior = behavior
    appliedReplayPolicy = replay
    if (behavior === 'restart_day_1') {
      result.enrollmentsRestarted = await restartEnrollments(input.campaignId, campaign, nowISO)
    } else if (behavior === 'only_new') {
      result.enrollmentsResumed = 0 // leave existing paused; only new enrollments proceed
    } else {
      result.enrollmentsResumed = await resumePaused(input.campaignId, campaign, replay, nowISO)
    }
  }

  await writeAudit({
    actor: input.actor,
    action: 'config.changed',
    entity: 'xsell_life_campaign',
    entityId: input.campaignId,
    diff: {
      control: input.action,
      prev: from,
      next: to,
      reason: input.reason ?? null,
      // Applied resume strategy (D11) — the campaign chose a behavior/replay policy on resume;
      // record which one actually ran so the audit trail explains why touches were skipped vs replayed.
      resume_behavior: appliedResumeBehavior,
      replay_policy: appliedReplayPolicy,
      enrollments_paused: result.enrollmentsPaused ?? null,
      enrollments_resumed: result.enrollmentsResumed ?? null,
      enrollments_restarted: result.enrollmentsRestarted ?? null,
    },
  })
  return result
}

interface SchedCfg { send_on_weekends: boolean; send_on_holidays: boolean; holiday_calendar: unknown }
function bizCfg(c: SchedCfg) {
  return {
    sendOnWeekends: c.send_on_weekends,
    sendOnHolidays: c.send_on_holidays,
    holidays: Array.isArray(c.holiday_calendar) ? (c.holiday_calendar as string[]) : [],
  }
}

/** Resume admin-paused enrollments to running. With replay_policy='skip' (default), fast-forward
 *  past any now-overdue touches (recording them as skipped executions) so no burst/catch-up occurs;
 *  with 'replay', fire the next pending touch on the next tick (next_touch_at = now). */
async function resumePaused(campaignId: string, cfg: SchedCfg, replay: ReplayPolicy, nowISO: string): Promise<number> {
  const db = getDb()
  const { data: rows } = await db
    .from('xsell_life_campaign_enrollments')
    .select('id, baseline_date, current_touch_no')
    .eq('campaign_id', campaignId)
    .eq('status', 'paused_by_admin')
    .limit(5000)
  let resumed = 0
  for (const e of rows ?? []) {
    const plan = computeTouchPlan(e.baseline_date as string)
    const today = nowISO.slice(0, 10)
    let cursor = e.current_touch_no as number
    let nextAt: string | null = null
    if (replay === 'skip') {
      // Record every past-due touch (cursor+1 … ) whose scheduled date < today as Skipped, then
      // resume at the first future touch. Bounded by the 35-touch plan.
      for (const p of plan) {
        if (p.touch_no <= cursor) continue
        if (p.dueDate < today) {
          await recordSkipped(db, e.id as string, p.touch_no, p.kind, nowISO)
          cursor = p.touch_no
        } else {
          nextAt = `${deferToBusinessDay(p.dueDate, bizCfg(cfg))}T13:00:00.000Z`
          break
        }
      }
    } else {
      const next = plan.find((p) => p.touch_no > (e.current_touch_no as number))
      nextAt = next ? nowISO : null
    }
    const patch: Record<string, unknown> = { status: 'running', previous_status: 'paused_by_admin', resumed_at: nowISO, updated_at: nowISO, current_touch_no: cursor }
    if (nextAt) patch.next_touch_at = nextAt
    if (!nextAt && cursor >= plan.length) { patch.status = 'completed'; patch.exit_reason = 'campaign_completed'; patch.completed_at = nowISO }
    await db.from('xsell_life_campaign_enrollments').update(patch).eq('id', e.id).eq('status', 'paused_by_admin')
    resumed++
  }
  return resumed
}

async function recordSkipped(db: ReturnType<typeof getDb>, enrollmentId: string, touchNo: number, kind: string, nowISO: string): Promise<void> {
  await db
    .from('xsell_life_campaign_executions')
    .insert({ enrollment_id: enrollmentId, touch_no: touchNo, kind, status: 'skipped', detail: { reason: 'resume_no_catchup' }, executed_at: nowISO })
    // idempotent on (enrollment_id, touch_no)
    .then(() => undefined, () => undefined)
}

/** Restart selected enrollments from Day 1 (§ Resume option 3). */
async function restartEnrollments(campaignId: string, cfg: SchedCfg, nowISO: string): Promise<number> {
  const db = getDb()
  const baseline = deferToBusinessDay(nowISO.slice(0, 10), bizCfg(cfg))
  const plan = computeTouchPlan(baseline)
  const firstDue = `${plan[0].dueDate}T13:00:00.000Z`
  const { data: rows } = await db
    .from('xsell_life_campaign_enrollments')
    .update({ status: 'running', previous_status: 'paused_by_admin', baseline_date: baseline, current_touch_no: 0, next_touch_at: firstDue, resumed_at: nowISO, updated_at: nowISO })
    .eq('campaign_id', campaignId)
    .eq('status', 'paused_by_admin')
    .select('id')
  return (rows ?? []).length
}

/** Restart a single enrollment from Day 1 (§ Enrollment Management → Restart enrollment). */
export async function restartEnrollment(input: { enrollmentId: string; actor: string }): Promise<{ ok: boolean }> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const { data: e } = await db
    .from('xsell_life_campaign_enrollments')
    .select('id, campaign_id, status')
    .eq('id', input.enrollmentId)
    .maybeSingle()
  if (!e) return { ok: false }
  const { data: c } = await db.from('xsell_life_campaigns').select('send_on_weekends, send_on_holidays, holiday_calendar').eq('id', e.campaign_id).maybeSingle()
  const baseline = deferToBusinessDay(nowISO.slice(0, 10), bizCfg(c as SchedCfg))
  const firstDue = `${computeTouchPlan(baseline)[0].dueDate}T13:00:00.000Z`
  await db
    .from('xsell_life_campaign_enrollments')
    .update({ status: 'running', previous_status: e.status, baseline_date: baseline, current_touch_no: 0, next_touch_at: firstDue, resumed_at: nowISO, updated_at: nowISO })
    .eq('id', input.enrollmentId)
  await writeAudit({ actor: input.actor, action: 'entity.updated', entity: 'xsell_life_campaign_enrollment', entityId: input.enrollmentId, diff: { restarted: true, prev: e.status } })
  return { ok: true }
}

/** Pause / resume a SINGLE enrollment (§ Enrollment Management → Pause/Resume enrollment). */
export async function setEnrollmentPause(input: { enrollmentId: string; pause: boolean; actor: string; reason?: string }): Promise<{ ok: boolean }> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const { data: e } = await db.from('xsell_life_campaign_enrollments').select('status').eq('id', input.enrollmentId).maybeSingle()
  if (!e) return { ok: false }
  if (input.pause) {
    await db.from('xsell_life_campaign_enrollments').update({ status: 'paused_by_admin', previous_status: e.status, paused_at: nowISO, pause_reason: input.reason ?? 'manual', updated_at: nowISO }).eq('id', input.enrollmentId).eq('status', 'running')
  } else {
    await db.from('xsell_life_campaign_enrollments').update({ status: 'running', previous_status: e.status, resumed_at: nowISO, updated_at: nowISO }).eq('id', input.enrollmentId).eq('status', 'paused_by_admin')
  }
  await writeAudit({ actor: input.actor, action: 'entity.updated', entity: 'xsell_life_campaign_enrollment', entityId: input.enrollmentId, diff: { pause: input.pause, prev: e.status, reason: input.reason ?? null } })
  return { ok: true }
}

// ── Versioning (§16): editing an Active version is forbidden; changes create a NEW Draft version ──
// that shares the family_key and copies the current touch template. Existing enrollments stay pinned
// to their version; historical touches/executions are immutable.
export async function createNewVersion(input: { campaignId: string; actor: string }): Promise<{ ok: boolean; newCampaignId?: string; version?: number; error?: string }> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const { data: base } = await db.from('xsell_life_campaigns').select('*').eq('id', input.campaignId).maybeSingle()
  if (!base) return { ok: false, error: 'campaign_missing' }
  const { data: maxRow } = await db
    .from('xsell_life_campaigns')
    .select('version')
    .eq('family_key', base.family_key)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextVersion = ((maxRow?.version as number) ?? (base.version as number)) + 1

  const clone: Record<string, unknown> = { ...base }
  delete clone.id
  delete clone.created_at
  delete clone.updated_at
  clone.version = nextVersion
  clone.status = 'draft'
  clone.simulated_at = null
  clone.last_simulation = null
  clone.activated_at = null
  clone.archived_at = null
  clone.emergency_stopped_at = null
  clone.emergency_stopped_by = null
  clone.created_by = input.actor
  const { data: created, error } = await db.from('xsell_life_campaigns').insert(clone).select('id').maybeSingle()
  if (error || !created) return { ok: false, error: 'clone_failed' }

  const { data: touches } = await db
    .from('xsell_life_campaign_touches')
    .select('touch_no, day_offset, kind, template_id, playbook_key, asset_label')
    .eq('campaign_id', input.campaignId)
    .order('touch_no', { ascending: true })
  if (touches && touches.length) {
    await db.from('xsell_life_campaign_touches').insert(touches.map((t) => ({ ...t, campaign_id: created.id })))
  }

  await writeAudit({ actor: input.actor, action: 'entity.created', entity: 'xsell_life_campaign', entityId: created.id as string, diff: { new_version: nextVersion, family_key: base.family_key, from: input.campaignId } })
  return { ok: true, newCampaignId: created.id as string, version: nextVersion }
}

// ── Settings update (§ Settings). Only permitted on a non-Active version (immutability §16) — an
// Active version must be re-versioned first. Audited with the field diff. ──
const EDITABLE_SETTINGS = new Set([
  'name', 'description', 'objective', 'daily_enrollment_limit', 'reenroll_cooldown_days',
  'resume_cooling_off_days', 'advisor_due_hours', 'advisor_overdue_escalate_hours',
  'advisor_reassign_after_hours', 'conversation_timeout_hours', 'advisor_hold_behavior',
  'intent_confidence_threshold', 'send_on_weekends', 'send_on_holidays', 'holiday_calendar',
  'resume_behavior', 'replay_policy', 'purpose', 'represented_agency_owner_id', 'delegation_id',
])

export async function updateSettings(input: { campaignId: string; actor: string; patch: Record<string, unknown> }): Promise<{ ok: boolean; error?: string }> {
  const db = getDb()
  const { data: campaign } = await db.from('xsell_life_campaigns').select('status').eq('id', input.campaignId).maybeSingle()
  if (!campaign) return { ok: false, error: 'campaign_missing' }
  if (campaign.status === 'active') return { ok: false, error: 'active_immutable' } // re-version first (§16)
  if (campaign.status === 'archived') return { ok: false, error: 'archived_readonly' }

  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input.patch)) if (EDITABLE_SETTINGS.has(k)) clean[k] = v
  if (Object.keys(clean).length === 0) return { ok: false, error: 'no_editable_fields' }
  clean.updated_at = new Date().toISOString()
  await db.from('xsell_life_campaigns').update(clean).eq('id', input.campaignId)
  await writeAudit({ actor: input.actor, action: 'config.changed', entity: 'xsell_life_campaign', entityId: input.campaignId, diff: { settings: clean } })
  return { ok: true }
}
