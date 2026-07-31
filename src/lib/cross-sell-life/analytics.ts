// src/lib/cross-sell-life/analytics.ts
// Read-only KPI / funnel aggregation for the Cross-Sell Life Campaign dashboard (§19). Counts
// enrollments by lifecycle state, executions by channel/outcome, advisor-touch state, and derives
// the conversion funnel (enrolled → reply → appointment → quote → application → issued) from the
// enrollment terminal states + execution outcomes. All reads through getDb(); no mutation.
// Opens are NOT treated as confirmed engagement (§19) — only inbound replies + terminal states are.
import { getDb } from '@/lib/supabase/client'

export interface CampaignAnalytics {
  status: string
  version: number
  enrollments: Record<string, number>
  totals: { active: number; completed: number; exited: number; suppressed: number }
  touches: { sent: number; suppressed: number; skipped: number; scheduled: number; missed: number; dead_letter: number }
  channels: { email: number; sms: number; ai: number }
  advisor: { total: number; fulfilled: number; overdue: number; missed: number }
  funnel: {
    enrolled: number
    appointments: number
    quotes: number
    applications: number
    issued: number
    purchasedElsewhere: number
    notInterested: number
    optOuts: number
  }
  rates: { enrollToAppointment: number; appointmentToQuote: number; quoteToApplication: number; applicationToIssued: number; overall: number }
}

const RUNNING_STATES = new Set(['running', 'paused_for_conversation', 'paused_by_admin', 'conversation_active', 'waiting_for_advisor', 'advisor_owned'])

function rate(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0
}

export async function campaignAnalytics(campaignId: string): Promise<CampaignAnalytics | null> {
  const db = getDb()
  const { data: campaign } = await db.from('xsell_life_campaigns').select('status, version').eq('id', campaignId).maybeSingle()
  if (!campaign) return null

  const { data: enrollRows } = await db
    .from('xsell_life_campaign_enrollments')
    .select('id, status, exit_reason')
    .eq('campaign_id', campaignId)
    .limit(20000)

  const enrollments: Record<string, number> = {}
  const totals = { active: 0, completed: 0, exited: 0, suppressed: 0 }
  const funnel = { enrolled: 0, appointments: 0, quotes: 0, applications: 0, issued: 0, purchasedElsewhere: 0, notInterested: 0, optOuts: 0 }
  const idList: string[] = []
  for (const r of enrollRows ?? []) {
    idList.push(r.id as string)
    enrollments[r.status] = (enrollments[r.status] ?? 0) + 1
    funnel.enrolled++
    if (RUNNING_STATES.has(r.status)) totals.active++
    if (r.status === 'completed') totals.completed++
    if (r.status === 'suppressed') totals.suppressed++
    if (r.status === 'appointment_scheduled') funnel.appointments++
    if (r.status === 'quote_requested') funnel.quotes++
    if (r.status === 'application_started') funnel.applications++
    if (r.status === 'policy_issued') funnel.issued++
    if (r.status === 'purchased_elsewhere') funnel.purchasedElsewhere++
    if (r.exit_reason === 'not_interested') funnel.notInterested++
    if (r.exit_reason === 'sms_stop' || r.exit_reason === 'email_unsubscribe' || r.exit_reason === 'global_suppression') funnel.optOuts++
  }
  totals.exited = (enrollments['cancelled'] ?? 0) + totals.suppressed

  const touches = { sent: 0, suppressed: 0, skipped: 0, scheduled: 0, missed: 0, dead_letter: 0 }
  const channels = { email: 0, sms: 0, ai: 0 }
  const advisor = { total: 0, fulfilled: 0, overdue: 0, missed: 0 }
  if (idList.length) {
    const { data: execs } = await db.from('xsell_life_campaign_executions').select('status, kind').in('enrollment_id', idList).limit(100000)
    for (const x of execs ?? []) {
      if (x.status in touches) (touches as Record<string, number>)[x.status]++
      if (x.status === 'sent') {
        if (x.kind === 'email') channels.email++
        else if (x.kind === 'ai_conversation') channels.ai++
        else channels.sms++
      }
    }
    const { data: adv } = await db.from('xsell_life_advisor_touches').select('status').in('enrollment_id', idList).limit(100000)
    for (const a of adv ?? []) {
      advisor.total++
      if (a.status === 'fulfilled') advisor.fulfilled++
      else if (a.status === 'overdue' || a.status === 'escalate' || a.status === 'reassign') advisor.overdue++
      else if (a.status === 'missed') advisor.missed++
    }
  }

  const rates = {
    enrollToAppointment: rate(funnel.appointments, funnel.enrolled),
    appointmentToQuote: rate(funnel.quotes, funnel.appointments),
    quoteToApplication: rate(funnel.applications, funnel.quotes),
    applicationToIssued: rate(funnel.issued, funnel.applications),
    overall: rate(funnel.issued, funnel.enrolled),
  }

  return { status: campaign.status as string, version: campaign.version as number, enrollments, totals, touches, channels, advisor, funnel, rates }
}
