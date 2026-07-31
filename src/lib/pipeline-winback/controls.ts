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
}

const PAUSE_ACTIONS = new Set<ControlAction>(['disable', 'emergency_stop', 'pause'])
const RESUME_ACTIONS = new Set<ControlAction>(['enable', 'resume'])

export async function applyControl(input: {
  campaignId: string
  action: ControlAction
  actor: string
  reason?: string
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

  // Enable / Resume: return admin-paused enrollments to active. No auto catch-up — the tick fires
  // at most one due touch per day, so resuming never bursts missed touches (§5a).
  if (RESUME_ACTIONS.has(input.action)) {
    const { data: resumed } = await db
      .from('pipeline_winback_enrollments')
      .update({ status: 'active', resumed_at: nowISO, updated_at: nowISO })
      .eq('campaign_id', input.campaignId)
      .eq('status', 'paused_by_admin')
      .select('id')
    result.enrollmentsResumed = (resumed ?? []).length
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
    },
  })
  return result
}
