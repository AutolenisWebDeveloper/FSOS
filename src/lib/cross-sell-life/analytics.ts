// src/lib/cross-sell-life/analytics.ts
// Read-only KPI / funnel aggregation for the Cross-Sell Life Campaign dashboard (§19). Reads
// enrollments, executions, and advisor touches, then hands the rows to the shared pure tallies
// in @/lib/comms/campaign-analytics so all three engines report one contract. Cross-Sell is the
// only engine that fills the `funnel`, `rates`, `channels`, and `version` blocks.
// All reads through getDb(); no mutation.
// Opens are NOT treated as confirmed engagement (§19) — only inbound replies + terminal states are.
import { getDb } from '@/lib/supabase/client'
import {
  tallyEnrollments,
  tallyExecutions,
  tallyAdvisor,
  tallyFunnel,
  funnelRates,
  type CampaignAnalytics,
} from '@/lib/comms/campaign-analytics'

export type { CampaignAnalytics }

/**
 * Cross-Sell models its funnel as enrollment STATUS, so a row sitting at
 * `appointment_scheduled` is both a funnel stage and still in flight. All of these count
 * as active; the timeline has not ended for them.
 */
const ACTIVE_STATES = [
  'running',
  'paused_for_conversation',
  'paused_by_admin',
  'conversation_active',
  'waiting_for_advisor',
  'advisor_owned',
] as const
const PAUSED_STATES = ['paused_for_conversation', 'paused_by_admin', 'conversation_active', 'waiting_for_advisor'] as const
const COMPLETED_STATES = ['completed', 'policy_issued'] as const
const EXITED_STATES = ['cancelled', 'purchased_elsewhere'] as const
const SUPPRESSED_STATES = ['suppressed'] as const

export async function campaignAnalytics(campaignId: string): Promise<CampaignAnalytics | null> {
  const db = getDb()
  const { data: campaign } = await db.from('xsell_life_campaigns').select('status, version').eq('id', campaignId).maybeSingle()
  if (!campaign) return null

  const { data: enrollRows } = await db
    .from('xsell_life_campaign_enrollments')
    .select('id, status, exit_reason')
    .eq('campaign_id', campaignId)
    .limit(20000)

  const rows = enrollRows ?? []
  const { enrollments, totals } = tallyEnrollments(rows, {
    activeStates: ACTIVE_STATES,
    pausedStates: PAUSED_STATES,
    completedStates: COMPLETED_STATES,
    exitedStates: EXITED_STATES,
    suppressedStates: SUPPRESSED_STATES,
  })
  const funnel = tallyFunnel(rows)
  const rates = funnelRates(funnel)

  const idList = rows.map((r) => r.id as string)
  let touches = tallyExecutions([]).touches
  let channels = tallyExecutions([]).channels
  let advisor = tallyAdvisor([])
  if (idList.length) {
    const [{ data: execs }, { data: adv }] = await Promise.all([
      db.from('xsell_life_campaign_executions').select('status, kind').in('enrollment_id', idList).limit(100000),
      db.from('xsell_life_advisor_touches').select('status').in('enrollment_id', idList).limit(100000),
    ])
    const tallied = tallyExecutions(execs ?? [])
    touches = tallied.touches
    channels = tallied.channels
    advisor = tallyAdvisor(adv ?? [])
  }

  return {
    status: campaign.status as string,
    version: campaign.version as number,
    enrollments,
    totals,
    touches,
    channels,
    advisor,
    funnel,
    rates,
  }
}
