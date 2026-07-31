// src/lib/pipeline-winback/analytics.ts
// Read-only KPI/event aggregation for the Pipeline Win-Back dashboard (§12/§13). Counts
// enrollments by lifecycle state, executions by channel/outcome, advisor-touch state, and the
// phase distribution (early / mid / accelerated) from each enrollment's cursor. Also surfaces
// the live "eligible / waiting" count straight from v_pipeline_winback_due (the single
// eligibility source, spec §0.9). All reads through getDb(); no mutation.
import { getDb } from '@/lib/supabase/client'

export interface WinbackAnalytics {
  status: string
  eligibleNow: number
  enrollments: Record<string, number>
  active: number
  completed: number
  exited: number
  byPhase: { early: number; mid: number; accelerated: number }
  byCategory: Record<string, number>
  touches: { sent: number; suppressed: number; skipped: number; scheduled: number }
  advisor: { total: number; fulfilled: number; overdue: number; missed: number }
}

const ACCEL_FROM_TOUCH = 13 // touch #13 (Day 90) begins the accelerated phase (§7)
const MID_FROM_TOUCH = 8 // touch #8 (Day 42) — first advisor outreach; mid-phase

const ACTIVE_STATES = ['active', 'paused_for_conversation', 'paused_by_admin']

export async function campaignAnalytics(campaignId: string): Promise<WinbackAnalytics | null> {
  const db = getDb()
  const { data: campaign } = await db.from('pipeline_winback_campaigns').select('status').eq('id', campaignId).maybeSingle()
  if (!campaign) return null

  // Live eligibility count from the view (the single source of truth, spec §0.9). The view
  // exposes the soft-suppression signals as columns; filtering by them here reads the view's
  // OWN output — it does not reimplement the eligibility WHERE clause.
  const { count: eligibleNow } = await db
    .from('v_pipeline_winback_due')
    .select('opportunity_id', { count: 'exact', head: true })
    .eq('do_not_contact', false)
    .eq('has_active_advisor_opportunity', false)
    .eq('has_upcoming_appointment', false)

  const { data: enrollRows } = await db
    .from('pipeline_winback_enrollments')
    .select('id, status, current_touch_no, winback_category')
    .eq('campaign_id', campaignId)
    .limit(10000)

  const enrollments: Record<string, number> = {}
  const byPhase = { early: 0, mid: 0, accelerated: 0 }
  const byCategory: Record<string, number> = {}
  const idList: string[] = []
  for (const r of enrollRows ?? []) {
    idList.push(r.id)
    enrollments[r.status] = (enrollments[r.status] ?? 0) + 1
    if (r.winback_category) byCategory[r.winback_category] = (byCategory[r.winback_category] ?? 0) + 1
    if (ACTIVE_STATES.includes(r.status)) {
      const n = r.current_touch_no ?? 0
      if (n >= ACCEL_FROM_TOUCH) byPhase.accelerated++
      else if (n >= MID_FROM_TOUCH) byPhase.mid++
      else byPhase.early++
    }
  }

  const touches = { sent: 0, suppressed: 0, skipped: 0, scheduled: 0 }
  const advisor = { total: 0, fulfilled: 0, overdue: 0, missed: 0 }
  if (idList.length) {
    const { data: execs } = await db.from('pipeline_winback_executions').select('status').in('enrollment_id', idList).limit(50000)
    for (const x of execs ?? []) {
      if (x.status === 'sent') touches.sent++
      else if (x.status === 'suppressed') touches.suppressed++
      else if (x.status === 'skipped') touches.skipped++
      else if (x.status === 'scheduled') touches.scheduled++
    }
    const { data: adv } = await db.from('pipeline_winback_advisor_touches').select('status').in('enrollment_id', idList).limit(50000)
    for (const a of adv ?? []) {
      advisor.total++
      if (a.status === 'fulfilled') advisor.fulfilled++
      else if (a.status === 'overdue' || a.status === 'escalate' || a.status === 'reassign') advisor.overdue++
      else if (a.status === 'missed') advisor.missed++
    }
  }

  return {
    status: campaign.status,
    eligibleNow: eligibleNow ?? 0,
    enrollments,
    active: enrollments['active'] ?? 0,
    completed: enrollments['completed'] ?? 0,
    exited: (enrollments['exited'] ?? 0) + (enrollments['suppressed'] ?? 0),
    byPhase,
    byCategory,
    touches,
    advisor,
  }
}
