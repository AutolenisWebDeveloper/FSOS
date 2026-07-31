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

  // Enable / Resume: return admin-paused enrollments to active. No auto catch-up — the tick
  // fires at most one due touch per day, so resuming never bursts missed touches (§4b).
  if (RESUME_ACTIONS.has(input.action)) {
    const { data: resumed } = await db
      .from('life_campaign_enrollments')
      .update({ status: 'active', resumed_at: nowISO, updated_at: nowISO })
      .eq('campaign_id', input.campaignId)
      .eq('status', 'paused_by_admin')
      .select('id')
    result.enrollmentsResumed = (resumed ?? []).length
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
  if (r.deadlineExposure) d.deadline_exposure = r.deadlineExposure
  return d
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
