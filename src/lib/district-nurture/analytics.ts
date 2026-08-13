// src/lib/district-nurture/analytics.ts
// Read-only KPI aggregation for the District Agent FS Nurture dashboard (ADR-038). Reads
// enrollments, executions, and live-touchpoint (advisor) rows, then hands them to the
// shared pure tallies in @/lib/comms/campaign-analytics so every engine reports one
// contract. Surfaces the live candidate count from v_district_nurture_candidates. All
// reads through getDb(); no mutation.
import { getDb } from '@/lib/supabase/client'
import {
  tallyEnrollments,
  tallyExecutions,
  tallyAdvisor,
  type CampaignAnalytics,
  type PhaseThresholds,
} from '@/lib/comms/campaign-analytics'

export type { CampaignAnalytics }

// Curriculum phases: mid opens at Module 5 (touch 14); accelerated at Module 9 (touch 27).
const PHASES: PhaseThresholds = { midFromTouch: 14, accelFromTouch: 27 }

const ACTIVE_STATES = ['active', 'paused_for_conversation', 'paused_by_admin'] as const
const PAUSED_STATES = ['paused_for_conversation', 'paused_by_admin'] as const
const COMPLETED_STATES = ['completed'] as const
const EXITED_STATES = ['exited'] as const
const SUPPRESSED_STATES = ['suppressed'] as const

export async function campaignAnalytics(campaignId: string): Promise<CampaignAnalytics | null> {
  const db = getDb()
  const { data: campaign } = await db.from('district_nurture_campaigns').select('status').eq('id', campaignId).maybeSingle()
  if (!campaign) return null

  const [{ count: eligibleNow }, { data: enrollRows }] = await Promise.all([
    db.from('v_district_nurture_candidates').select('agency_owner_id', { count: 'exact', head: true }).eq('reachable', true),
    db
      .from('district_nurture_enrollments')
      .select('id, status, current_touch_no')
      .eq('campaign_id', campaignId)
      .limit(10000),
  ])

  const rows = enrollRows ?? []
  const { enrollments, totals, byPhase } = tallyEnrollments(rows, {
    activeStates: ACTIVE_STATES,
    pausedStates: PAUSED_STATES,
    completedStates: COMPLETED_STATES,
    exitedStates: EXITED_STATES,
    suppressedStates: SUPPRESSED_STATES,
    phases: PHASES,
  })

  const idList = rows.map((r) => r.id as string)
  let touches = tallyExecutions([]).touches
  let advisor = tallyAdvisor([])
  if (idList.length) {
    const [{ data: execs }, { data: adv }] = await Promise.all([
      db.from('district_nurture_executions').select('status, kind').in('enrollment_id', idList).limit(50000),
      db.from('district_nurture_advisor_touches').select('status').in('enrollment_id', idList).limit(50000),
    ])
    touches = tallyExecutions(execs ?? []).touches
    advisor = tallyAdvisor(adv ?? [])
  }

  return {
    status: campaign.status as string,
    eligibleNow: eligibleNow ?? 0,
    enrollments,
    totals,
    byPhase,
    touches,
    advisor,
  }
}
