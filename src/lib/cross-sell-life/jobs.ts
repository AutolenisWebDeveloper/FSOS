// src/lib/cross-sell-life/jobs.ts
// The Cross-Sell Life daily eligibility + enrollment sweep and the retry/dead-letter sweep (§24).
// Kept out of the cron handler so it is unit-testable. Enrollment only runs when the campaign is
// Active (§ Enrollment Behavior While Disabled: eligibility may run, but no new enrollments when
// Disabled) and respects the configurable daily_enrollment_limit across runs (§5). Every enrollment
// recomputes eligibility (enroll.ts) and routes NOTHING outbound — sends happen in the tick.
import { getDb } from '@/lib/supabase/client'
import { resolveOrphanExecution, type OrphanRow } from '@/lib/ops/orphan-executions'
import { loadActiveCampaign, listGapHouseholds, primaryMemberForHousehold } from './data'
import { enrollContact } from './enroll'

export interface DailyEnrollResult {
  ok: boolean
  enrolled: number
  considered: number
  note: string
}

const SYSTEM = 'agent:cross_sell'

/** Daily eligibility + enrollment: fills the day's quota from the highest-scoring gap households. */
export async function runDailyEnrollment(): Promise<DailyEnrollResult> {
  const db = getDb()
  const campaign = await loadActiveCampaign()
  if (!campaign) return { ok: true, enrolled: 0, considered: 0, note: 'cross-sell-life-enroll: no campaign' }
  if (campaign.status !== 'active') {
    return { ok: true, enrolled: 0, considered: 0, note: `cross-sell-life-enroll: campaign ${campaign.status} — enrollment paused` }
  }

  // Remaining daily quota = limit − already enrolled today (across earlier runs), so the daily cap
  // holds even if the job runs more than once (§5). UTC day boundary matches enrolled_at storage.
  const startOfDay = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
  const { count: enrolledToday } = await db
    .from('xsell_life_campaign_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .gte('enrolled_at', startOfDay)
  const remaining = Math.max(0, campaign.daily_enrollment_limit - (enrolledToday ?? 0))
  if (remaining === 0) return { ok: true, enrolled: 0, considered: 0, note: 'cross-sell-life-enroll: daily limit reached' }

  // Over-fetch a little: many candidates fail the fuller eligibility recheck (life opp/app, dup,
  // population separation), so scan up to 4× the remaining quota to fill it.
  const candidates = await listGapHouseholds(remaining * 4)
  let enrolled = 0
  let considered = 0
  for (const gap of candidates) {
    if (enrolled >= remaining) break
    considered++
    const member = await primaryMemberForHousehold(gap.household_id)
    if (!member) continue
    const res = await enrollContact({
      campaignId: campaign.id,
      householdId: gap.household_id,
      memberId: member.id,
      actor: SYSTEM,
    })
    if (res.enrolled) enrolled++
  }
  return { ok: true, enrolled, considered, note: `cross-sell-life-enroll: ${enrolled} enrolled (${considered} considered, quota ${remaining})` }
}

export interface RetrySweepResult { ok: boolean; retried: number; deadLettered: number; note: string }

/** Retry/dead-letter sweep (§20): re-queue message executions still 'scheduled' past their retry
 *  time, and move ones past the retry ceiling to 'dead_letter' for operator attention. Bounded. */
export async function runRetrySweep(maxAttempts = 5): Promise<RetrySweepResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const { data: stuck, error: stuckErr } = await db
    .from('xsell_life_campaign_executions')
    .select('id, attempts, enrollment_id, touch_no, kind')
    .eq('status', 'scheduled')
    .not('idempotency_key', 'is', null)
    .lte('next_retry_at', nowISO)
    .limit(500)
  // R17b: a failed read is a failed run, not "0 re-queued".
  if (stuckErr) return { ok: false, retried: 0, deadLettered: 0, note: `cross-sell-life-retry: could not read the retry queue (${stuckErr.message})` }
  let retried = 0
  let deadLettered = 0
  let reconciled = 0
  let released = 0
  for (const x of stuck ?? []) {
    // Orphaned claim: the message of record decides — reconcile a send that went out, or (switch
    // ON) release a never-dispatched claim for the tick to re-attempt. Else the backoff below.
    const orphan = await resolveOrphanExecution(db, 'xsell_life_campaign_executions', 'xsell_life_campaign_enrollment', x as unknown as OrphanRow)
    if (orphan === 'reconciled_sent') { reconciled++; continue }
    if (orphan === 'released') { released++; continue }
    const attempts = ((x.attempts as number) ?? 0) + 1
    if (attempts >= maxAttempts) {
      await db.from('xsell_life_campaign_executions').update({ status: 'dead_letter', attempts, detail: { reason: 'retry_exhausted' } }).eq('id', x.id)
      deadLettered++
    } else {
      const backoffMin = [5, 30, 120, 1440][Math.min(attempts - 1, 3)]
      await db.from('xsell_life_campaign_executions').update({ attempts, next_retry_at: new Date(Date.now() + backoffMin * 60000).toISOString() }).eq('id', x.id)
      retried++
    }
  }
  return { ok: true, retried, deadLettered, note: `cross-sell-life-retry: ${retried} re-queued, ${deadLettered} dead-lettered, ${reconciled} reconciled as sent, ${released} released for re-dispatch` }
}
