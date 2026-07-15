// src/jobs/handlers.ts
// Concrete P1 job logic (build-order Phase 2). Every job is idempotent (the cron
// route wraps each in runIdempotent by job:date), and every client-facing action
// routes through the dispatcher/gate. Jobs never bypass consent/quiet-hours/DNC or
// the securities firewall. Read-only detection jobs create tasks/escalations only.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { dispatchCampaign } from '@/lib/comms/campaign'
import type { JobResult } from './index'

const SYSTEM = 'system'

// renewal-watch — policies renewing soon → a follow-up task (no client send).
export async function renewalWatch(): Promise<JobResult> {
  const db = getDb()
  const soon = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10)
  const { data } = await db.from('household_policies').select('id, household_id, renewal_date').is('deleted_at', null).not('renewal_date', 'is', null).lte('renewal_date', soon).gte('renewal_date', new Date().toISOString().slice(0, 10)).limit(500)
  let handled = 0
  for (const p of data ?? []) {
    const dedupe = `renewal:${p.id}:${p.renewal_date}`
    const { data: exists } = await db.from('work_tasks').select('id').eq('entity_type', 'policy').eq('entity_id', p.id).like('title', 'Renewal review%').limit(1).maybeSingle()
    if (exists) continue
    await db.from('work_tasks').insert({ title: `Renewal review due ${p.renewal_date}`, entity_type: 'policy', entity_id: p.id, source: 'workflow' })
    await writeAudit({ actor: SYSTEM, action: 'entity.created', entity: 'work_task', diff: { job: 'renewal-watch', dedupe } })
    handled++
  }
  return { ok: true, handled, note: `renewal-watch: ${handled} renewal tasks` }
}

// xdate-watch — competitor policies (!is_with_us) with an approaching x_date → task.
export async function xdateWatch(): Promise<JobResult> {
  const db = getDb()
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)
  const { data } = await db.from('household_policies').select('id, household_id, x_date').is('deleted_at', null).eq('is_with_us', false).not('x_date', 'is', null).lte('x_date', soon).gte('x_date', new Date().toISOString().slice(0, 10)).limit(500)
  let handled = 0
  for (const p of data ?? []) {
    const { data: exists } = await db.from('work_tasks').select('id').eq('entity_type', 'policy').eq('entity_id', p.id).like('title', 'X-date outreach%').limit(1).maybeSingle()
    if (exists) continue
    await db.from('work_tasks').insert({ title: `X-date outreach window ${p.x_date}`, entity_type: 'policy', entity_id: p.id, source: 'workflow' })
    handled++
  }
  return { ok: true, handled, note: `xdate-watch: ${handled} x-date tasks` }
}

// conversion-watch — term policies entering their window → educational enrollment log
// (green-zone). Securities-flagged policies are excluded (firewall).
export async function conversionWatch(): Promise<JobResult> {
  const db = getDb()
  const { data } = await db.from('v_conversions_due').select('policy_id, household_id, is_security, urgency_tier').neq('urgency_tier', 'beyond').limit(1000)
  let handled = 0, excluded = 0
  for (const row of data ?? []) {
    if (row.is_security) { excluded++; continue } // firewall: never auto-enroll securities
    const { data: exists } = await db.from('activities').select('id').eq('entity_type', 'policy').eq('entity_id', row.policy_id).eq('kind', 'conversion_identify').limit(1).maybeSingle()
    if (exists) continue
    await db.from('activities').insert({ entity_type: 'policy', entity_id: row.policy_id, kind: 'conversion_identify', note: `Identified for educational conversion cadence (tier ≤${row.urgency_tier}d)`, actor: SYSTEM })
    await writeAudit({ actor: SYSTEM, action: 'ai.action', entity: 'policy', entityId: row.policy_id, diff: { job: 'conversion-watch', greenzone: true } })
    handled++
  }
  return { ok: true, handled, note: `conversion-watch: ${handled} identified, ${excluded} securities excluded` }
}

// cross-sell-scan — households with a coverage gap → invitation-only identification.
export async function crossSellScan(): Promise<JobResult> {
  const db = getDb()
  const { data } = await db.from('v_cross_sell_gaps').select('household_id, next_best_line').order('score', { ascending: false }).limit(1000)
  let handled = 0
  for (const row of data ?? []) {
    const { data: exists } = await db.from('activities').select('id').eq('entity_type', 'household').eq('entity_id', row.household_id).eq('kind', 'crosssell_identify').limit(1).maybeSingle()
    if (exists) continue
    await db.from('activities').insert({ entity_type: 'household', entity_id: row.household_id, kind: 'crosssell_identify', note: `Coverage gap identified (next: ${row.next_best_line ?? '—'}) — review invitation opportunity`, actor: SYSTEM })
    handled++
  }
  return { ok: true, handled, note: `cross-sell-scan: ${handled} gaps identified (invitation only)` }
}

// referral-sla — untouched referrals past SLA → escalation to the FSA.
export async function referralSla(): Promise<JobResult> {
  const db = getDb()
  const { data } = await db.from('v_referrals_awaiting_action').select('id, sla_breached').eq('sla_breached', true).limit(500)
  let handled = 0
  for (const r of data ?? []) {
    const { data: exists } = await db.from('agent_actions').select('id').eq('target_type', 'referral').eq('target_id', r.id).eq('reason', 'sla_breach').limit(1).maybeSingle()
    if (exists) continue
    await db.from('agent_actions').insert({ kind: 'escalation', actor: SYSTEM, outcome: 'escalated', target_type: 'referral', target_id: r.id, reason: 'sla_breach', note: 'Referral untouched past SLA — needs first touch.' })
    await writeAudit({ actor: SYSTEM, action: 'ai.escalated', entity: 'referral', entityId: r.id, diff: { reason: 'sla_breach' } })
    handled++
  }
  return { ok: true, handled, note: `referral-sla: ${handled} SLA escalations` }
}

// agency-dormancy — overdue-checkin agencies → dormant status + reactivation task.
export async function agencyDormancy(): Promise<JobResult> {
  const db = getDb()
  const { data } = await db.from('v_agencies_overdue_checkin').select('id, overdue_checkin, status').eq('overdue_checkin', true).limit(500)
  let handled = 0
  for (const a of data ?? []) {
    if (a.status === 'terminated') continue
    const { data: exists } = await db.from('work_tasks').select('id').eq('entity_type', 'agency').eq('entity_id', a.id).like('title', 'Reactivation%').limit(1).maybeSingle()
    if (exists) continue
    if (a.status === 'producing' || a.status === 'activated') await db.from('agency_partnerships').update({ status: 'dormant', updated_at: new Date().toISOString() }).eq('id', a.id)
    await db.from('work_tasks').insert({ title: 'Reactivation check-in', entity_type: 'agency', entity_id: a.id, source: 'workflow' })
    await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'agency_partnership', entityId: a.id, diff: { job: 'agency-dormancy', status: 'dormant' } })
    handled++
  }
  return { ok: true, handled, note: `agency-dormancy: ${handled} dormant flagged` }
}

// commission-reconcile — expected vs received gaps → flag discrepancy.
export async function commissionReconcile(): Promise<JobResult> {
  const db = getDb()
  const { data } = await db.from('commissions').select('id, total_commission, received_amount, reconciliation_status').in('reconciliation_status', ['expected', 'received']).limit(2000)
  let handled = 0
  for (const c of data ?? []) {
    const total = Number(c.total_commission ?? 0)
    const received = Number(c.received_amount ?? 0)
    let status = c.reconciliation_status
    if (received >= total && total > 0) status = 'matched'
    else if (received > 0 && received < total) status = 'discrepancy'
    if (status !== c.reconciliation_status) {
      await db.from('commissions').update({ reconciliation_status: status, updated_at: new Date().toISOString() }).eq('id', c.id)
      await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'commission', entityId: c.id, diff: { job: 'commission-reconcile', reconciliation_status: status } })
      handled++
    }
  }
  return { ok: true, handled, note: `commission-reconcile: ${handled} reconciled` }
}

// campaign-dispatch — active campaigns → dispatch through the 7-step gate per recipient.
export async function campaignDispatch(): Promise<JobResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const { data } = await db.from('comm_campaigns').select('id, schedule_at').eq('status', 'active').is('archived_at', null).limit(100)
  let sent = 0, suppressed = 0
  for (const c of data ?? []) {
    if (c.schedule_at && c.schedule_at > nowISO) continue // not due yet
    const result = await dispatchCampaign(c.id, `agent:marketing_automation`)
    if (!('error' in result)) { sent += result.sent; suppressed += result.suppressed }
  }
  return { ok: true, handled: sent, note: `campaign-dispatch: ${sent} sent, ${suppressed} suppressed (all through the gate)` }
}

// data-quality — flag households/members missing contact info.
export async function dataQuality(): Promise<JobResult> {
  const db = getDb()
  const { count } = await db.from('household_members').select('id', { count: 'exact', head: true }).is('email', null).is('phone', null)
  return { ok: true, handled: count ?? 0, note: `data-quality: ${count ?? 0} members missing contact info` }
}

// backup-verify — record a backup-verification heartbeat (independent pg_dump is external).
export async function backupVerify(): Promise<JobResult> {
  const db = getDb()
  await writeAudit({ actor: SYSTEM, action: 'config.changed', entity: 'backup', diff: { job: 'backup-verify', verified_at: new Date().toISOString(), note: 'restore-test heartbeat' } })
  await db.from('activities').insert({ entity_type: 'system', kind: 'backup_verify', note: 'Backup verification heartbeat', actor: SYSTEM }).select('id').maybeSingle()
  return { ok: true, note: 'backup-verify: heartbeat recorded' }
}
