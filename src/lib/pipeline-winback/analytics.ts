// src/lib/pipeline-winback/analytics.ts
// Read-only KPI/event aggregation for the Pipeline Win-Back dashboard (§12/§13). Reads
// enrollments, executions, and advisor touches, then hands the rows to the shared pure
// tallies in @/lib/comms/campaign-analytics so all three engines report one contract.
// Also surfaces the live "eligible / waiting" count straight from v_pipeline_winback_due
// (the single eligibility source, spec §0.9). All reads through getDb(); no mutation.
import { getDb } from '@/lib/supabase/client'
import {
  tallyEnrollments,
  tallyExecutions,
  tallyAdvisor,
  type CampaignAnalytics,
  type PhaseThresholds,
} from '@/lib/comms/campaign-analytics'

export type { CampaignAnalytics }

// §7: touch #8 (Day 42) is the first advisor outreach and opens the mid phase; touch #13
// (Day 90) opens the accelerated phase.
const PHASES: PhaseThresholds = { midFromTouch: 8, accelFromTouch: 13 }

const ACTIVE_STATES = ['active', 'paused_for_conversation', 'paused_by_admin'] as const
const PAUSED_STATES = ['paused_for_conversation', 'paused_by_admin'] as const
const COMPLETED_STATES = ['completed'] as const
const EXITED_STATES = ['exited'] as const
const SUPPRESSED_STATES = ['suppressed'] as const

export async function campaignAnalytics(campaignId: string): Promise<CampaignAnalytics | null> {
  const db = getDb()
  const { data: campaign } = await db.from('pipeline_winback_campaigns').select('status').eq('id', campaignId).maybeSingle()
  if (!campaign) return null

  // Live eligibility count from the view (the single source of truth, spec §0.9). The view
  // exposes the soft-suppression signals as columns; filtering by them here reads the view's
  // OWN output — it does not reimplement the eligibility WHERE clause.
  const [{ count: eligibleNow }, { data: enrollRows }] = await Promise.all([
    db
      .from('v_pipeline_winback_due')
      .select('opportunity_id', { count: 'exact', head: true })
      .eq('do_not_contact', false)
      .eq('has_active_advisor_opportunity', false)
      .eq('has_upcoming_appointment', false),
    db
      .from('pipeline_winback_enrollments')
      .select('id, status, current_touch_no, winback_category')
      .eq('campaign_id', campaignId)
      .limit(10000),
  ])

  const rows = enrollRows ?? []
  const { enrollments, totals, byPhase, byCategory } = tallyEnrollments(rows, {
    activeStates: ACTIVE_STATES,
    pausedStates: PAUSED_STATES,
    completedStates: COMPLETED_STATES,
    exitedStates: EXITED_STATES,
    suppressedStates: SUPPRESSED_STATES,
    phases: PHASES,
    categorize: true,
  })

  const idList = rows.map((r) => r.id as string)
  let touches = tallyExecutions([]).touches
  let advisor = tallyAdvisor([])
  if (idList.length) {
    const [{ data: execs }, { data: adv }] = await Promise.all([
      db.from('pipeline_winback_executions').select('status, kind').in('enrollment_id', idList).limit(50000),
      db.from('pipeline_winback_advisor_touches').select('status').in('enrollment_id', idList).limit(50000),
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
    byCategory,
    touches,
    advisor,
  }
}
