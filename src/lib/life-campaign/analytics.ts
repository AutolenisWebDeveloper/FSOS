// src/lib/life-campaign/analytics.ts
// Read-only KPI/event aggregation for the Life Conversion Campaign dashboard (§15). Counts
// enrollments by lifecycle state, executions by channel/outcome, and advisor-touch state, and
// derives the phase distribution (early / mid / accelerated) from each enrollment's cursor.
// All reads through getDb(); no mutation.
import { getDb } from '@/lib/supabase/client'

export interface CampaignAnalytics {
  status: string
  enrollments: Record<string, number>
  active: number
  completed: number
  exited: number
  byPhase: { early: number; mid: number; accelerated: number }
  touches: { sent: number; suppressed: number; skipped: number; scheduled: number }
  advisor: { total: number; fulfilled: number; overdue: number; missed: number }
}

const ACCEL_FROM_TOUCH = 13 // touch #13 (Day 135) begins the accelerated phase (§5)
const MID_FROM_TOUCH = 7 // touch #7 (Day 48) — first advisor outreach; mid-phase

export async function campaignAnalytics(campaignId: string): Promise<CampaignAnalytics | null> {
  const db = getDb()
  const { data: campaign } = await db.from('life_campaigns').select('status').eq('id', campaignId).maybeSingle()
  if (!campaign) return null

  const { data: enrollRows } = await db
    .from('life_campaign_enrollments')
    .select('status, current_touch_no')
    .eq('campaign_id', campaignId)
    .limit(10000)

  const enrollments: Record<string, number> = {}
  const byPhase = { early: 0, mid: 0, accelerated: 0 }
  for (const r of enrollRows ?? []) {
    enrollments[r.status] = (enrollments[r.status] ?? 0) + 1
    if (r.status === 'active' || r.status === 'paused_for_conversation' || r.status === 'paused_by_admin') {
      const n = r.current_touch_no ?? 0
      if (n >= ACCEL_FROM_TOUCH) byPhase.accelerated++
      else if (n >= MID_FROM_TOUCH) byPhase.mid++
      else byPhase.early++
    }
  }

  // Execution outcomes (join through enrollments of this campaign).
  const enrollmentIds = (enrollRows ?? []).length
  const touches = { sent: 0, suppressed: 0, skipped: 0, scheduled: 0 }
  const advisor = { total: 0, fulfilled: 0, overdue: 0, missed: 0 }
  if (enrollmentIds > 0) {
    const { data: ids } = await db.from('life_campaign_enrollments').select('id').eq('campaign_id', campaignId).limit(10000)
    const idList = (ids ?? []).map((x) => x.id)
    if (idList.length) {
      const { data: execs } = await db
        .from('life_campaign_executions')
        .select('status')
        .in('enrollment_id', idList)
        .limit(50000)
      for (const x of execs ?? []) {
        if (x.status === 'sent') touches.sent++
        else if (x.status === 'suppressed') touches.suppressed++
        else if (x.status === 'skipped') touches.skipped++
        else if (x.status === 'scheduled') touches.scheduled++
      }
      const { data: adv } = await db.from('life_advisor_touches').select('status').in('enrollment_id', idList).limit(50000)
      for (const a of adv ?? []) {
        advisor.total++
        if (a.status === 'fulfilled') advisor.fulfilled++
        else if (a.status === 'overdue' || a.status === 'escalate' || a.status === 'reassign') advisor.overdue++
        else if (a.status === 'missed') advisor.missed++
      }
    }
  }

  return {
    status: campaign.status,
    enrollments,
    active: enrollments['active'] ?? 0,
    completed: enrollments['completed'] ?? 0,
    exited: (enrollments['exited'] ?? 0) + (enrollments['suppressed'] ?? 0),
    byPhase,
    touches,
    advisor,
  }
}
