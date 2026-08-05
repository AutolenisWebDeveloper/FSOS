// src/lib/life-campaign/analytics.ts
// Read-only KPI/event aggregation for the Life Conversion Campaign dashboard (§15). Reads
// enrollments, executions, and advisor touches, then hands the rows to the shared pure
// tallies in @/lib/comms/campaign-analytics so all three engines report one contract.
// All reads through getDb(); no mutation.
import { getDb } from '@/lib/supabase/client'
import {
  tallyEnrollments,
  tallyExecutions,
  tallyAdvisor,
  type CampaignAnalytics,
  type PhaseThresholds,
} from '@/lib/comms/campaign-analytics'

export type { CampaignAnalytics }

// §5: touch #7 (Day 48) is the first advisor outreach and opens the mid phase; touch #13
// (Day 135) opens the accelerated phase.
const PHASES: PhaseThresholds = { midFromTouch: 7, accelFromTouch: 13 }

/** Still moving through the timeline. `byPhase` counts this same population. */
const ACTIVE_STATES = ['active', 'paused_for_conversation', 'paused_by_admin'] as const
const PAUSED_STATES = ['paused_for_conversation', 'paused_by_admin'] as const
const COMPLETED_STATES = ['completed'] as const
const EXITED_STATES = ['exited'] as const
const SUPPRESSED_STATES = ['suppressed'] as const

export async function campaignAnalytics(campaignId: string): Promise<CampaignAnalytics | null> {
  const db = getDb()
  const { data: campaign } = await db.from('life_campaigns').select('status').eq('id', campaignId).maybeSingle()
  if (!campaign) return null

  const { data: enrollRows } = await db
    .from('life_campaign_enrollments')
    .select('id, status, current_touch_no')
    .eq('campaign_id', campaignId)
    .limit(10000)

  const rows = enrollRows ?? []
  const { enrollments, totals, byPhase } = tallyEnrollments(rows, {
    activeStates: ACTIVE_STATES,
    pausedStates: PAUSED_STATES,
    completedStates: COMPLETED_STATES,
    exitedStates: EXITED_STATES,
    suppressedStates: SUPPRESSED_STATES,
    phases: PHASES,
  })

  // Execution outcomes join through this campaign's enrollments. The previous version
  // issued a second query for the ids it already had in `enrollRows` — one round trip
  // removed, same result.
  const idList = rows.map((r) => r.id as string)
  let touches = tallyExecutions([]).touches
  let advisor = tallyAdvisor([])
  if (idList.length) {
    const [{ data: execs }, { data: adv }] = await Promise.all([
      db.from('life_campaign_executions').select('status, kind').in('enrollment_id', idList).limit(50000),
      db.from('life_advisor_touches').select('status').in('enrollment_id', idList).limit(50000),
    ])
    touches = tallyExecutions(execs ?? []).touches
    advisor = tallyAdvisor(adv ?? [])
  }

  return { status: campaign.status as string, enrollments, totals, byPhase, touches, advisor }
}
