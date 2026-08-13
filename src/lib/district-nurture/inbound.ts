// src/lib/district-nurture/inbound.ts
// Conversation-close RESUME for the District Agent FS Nurture Campaign (ADR-038).
//
// Pause and opt-out are handled the same way the client engines handle them (CLAUDE.md §6 — one
// pattern, not a parallel one): the tick's per-touch eligibility recheck moves an enrollment to
// paused_for_conversation when a live conversation is open (ADR-018) and to suppressed on opt-out,
// and the send gate independently blocks every send to an opted-out/DNC contact at send time
// (immediate). This module supplies only the RESUME half — reactivating an enrollment once its
// workflow (reply / meeting / referral conversation) has closed, with NO catch-up. It is invoked
// by the tick's resume sweep, scoped to the campaign being ticked.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { computeTouchPlan, nextDueTouch } from './schedule'

const SYSTEM = 'agent:marketing_automation'

/**
 * Resume enrollments paused by a closed workflow (paused_for_conversation) for one agency owner
 * WITHIN a single campaign — the cadence fast-forwards to the next future touch (no catch-up for
 * days missed while paused). Scoped by campaign_id so resuming one campaign never touches an
 * agent's enrollment in another. Admin-paused rows are left alone (only the operator un-pauses
 * those). Idempotent.
 */
export async function resumeAfterWorkflow(input: {
  campaignId: string
  agencyOwnerId: string
  actor?: string
}): Promise<{ resumed: number }> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const today = nowISO.slice(0, 10)

  const { data: rows } = await db
    .from('district_nurture_enrollments')
    .select('id, baseline_date, current_touch_no')
    .eq('campaign_id', input.campaignId)
    .eq('agency_owner_id', input.agencyOwnerId)
    .eq('status', 'paused_for_conversation')
    .limit(100)

  let resumed = 0
  for (const e of rows ?? []) {
    // Fast-forward the cursor past every touch that came due while paused (no catch-up).
    const plan = computeTouchPlan(e.baseline_date as string)
    let cursor = e.current_touch_no as number
    for (const t of plan) {
      if (t.touch_no > cursor && t.dueDate < today) cursor = t.touch_no
    }
    const next = nextDueTouch(cursor, e.baseline_date as string)
    const patch: Record<string, unknown> = {
      status: 'active',
      current_touch_no: cursor,
      resumed_at: nowISO,
      updated_at: nowISO,
    }
    if (next) patch.next_touch_at = `${next.dueDate}T13:00:00.000Z`
    else {
      patch.status = 'completed'
      patch.completed_at = nowISO
    }
    await db.from('district_nurture_enrollments').update(patch).eq('id', e.id).eq('status', 'paused_for_conversation')
    await writeAudit({
      actor: input.actor ?? SYSTEM,
      action: 'entity.updated',
      entity: 'district_nurture_enrollment',
      entityId: e.id as string,
      diff: { resumed_after_workflow: true },
    })
    resumed++
  }
  return { resumed }
}
