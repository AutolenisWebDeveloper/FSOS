// src/jobs/handlers.ts
// Concrete P1 job logic (build-order Phase 2). Every job is idempotent (the cron
// route wraps each in runIdempotent by job:date), and every client-facing action
// routes through the dispatcher/gate. Jobs never bypass consent/quiet-hours/DNC or
// the securities firewall. Read-only detection jobs create tasks/escalations only.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { dispatchCampaign, refreshCampaignMetrics, campaignDispatchContext, type CampaignDispatchContext } from '@/lib/comms/campaign'
import { sendThroughGate, isTemplateApproved } from '@/lib/comms/send'
import { evaluateResume } from '@/lib/comms/conversation-mode'
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

// campaign-dispatch — active campaigns → dispatch through the 7-step gate per recipient,
// then advance any due drip-sequence enrollments (also gated). Metrics are refreshed
// so the campaign cards show live delivery/open/click counts.
export async function campaignDispatch(): Promise<JobResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const { data } = await db.from('comm_campaigns').select('id, schedule_at').eq('status', 'active').is('archived_at', null).limit(100)
  let sent = 0, suppressed = 0
  for (const c of data ?? []) {
    if (c.schedule_at && c.schedule_at > nowISO) continue // not due yet
    const result = await dispatchCampaign(c.id, `agent:marketing_automation`)
    if (!('error' in result)) { sent += result.sent; suppressed += result.suppressed }
    await refreshCampaignMetrics(c.id)
  }
  const drip = await dripAdvance()
  const dripHandled = drip.handled ?? 0
  return { ok: true, handled: sent + dripHandled, note: `campaign-dispatch: ${sent} broadcast sent, ${suppressed} suppressed; drip: ${dripHandled} steps (all through the gate)` }
}

// dripAdvance — advance due drip-sequence enrollments one step. Each step send
// passes the same 7-step gate; a completed sequence is marked done. Idempotent by
// next_send_at gating (a step only fires once its due time passes).
export async function dripAdvance(): Promise<JobResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  // Due enrollments across all active drip campaigns.
  const { data: enrollments } = await db
    .from('comm_campaign_enrollments')
    .select('id, campaign_id, member_id, household_id, agency_id, current_step, comm_campaigns!inner(id, type, channel, sequence_id, status, archived_at, purpose, represented_agency_owner_id, delegation_id)')
    .eq('status', 'enrolled')
    .lte('next_send_at', nowISO)
    .limit(1000)

  // Slice 7 — resolve each drip campaign's purpose + delegated-sender context once, cached
  // by campaign id (most campaigns aren't delegated; a delegated one loads its row once).
  const ctxCache = new Map<string, CampaignDispatchContext>()

  let handled = 0
  for (const e of (enrollments ?? []) as unknown as Array<{ id: string; campaign_id: string; member_id: string; household_id: string; agency_id: string | null; current_step: number; comm_campaigns: { id: string; type: string; channel: string; sequence_id: string | null; status: string; archived_at: string | null; purpose: string | null; represented_agency_owner_id: string | null; delegation_id: string | null } }>) {
    const camp = e.comm_campaigns
    if (!camp || camp.type !== 'drip' || camp.status !== 'active' || camp.archived_at || !camp.sequence_id) continue

    const { data: seq } = await db.from('comm_sequences').select('steps, status, purpose').eq('id', camp.sequence_id).maybeSingle()
    const steps = (seq?.steps ?? []) as Array<{ delay_days: number; template_id?: string; subject?: string }>
    if (!seq || seq.status !== 'active' || e.current_step >= steps.length) {
      await db.from('comm_campaign_enrollments').update({ status: 'completed' }).eq('id', e.id)
      continue
    }

    const step = steps[e.current_step]
    if (!step?.template_id || !(await isTemplateApproved(step.template_id))) {
      // Skip an unapproved/empty step but keep advancing so the drip doesn't stall.
      await db.from('comm_campaign_enrollments').update({ current_step: e.current_step + 1, next_send_at: nowISO }).eq('id', e.id)
      continue
    }

    const { data: member } = await db.from('household_members').select('email, phone, full_name').eq('id', e.member_id).maybeSingle()
    const to = camp.channel === 'email' ? member?.email : member?.phone
    if (to) {
      const { data: tpl } = await db.from('comm_templates').select('body').eq('id', step.template_id).maybeSingle()
      // Slice 7 — purpose (campaign, else sequence default) + delegated-sender context.
      let campCtx = ctxCache.get(camp.id)
      if (!campCtx) {
        campCtx = await campaignDispatchContext({
          id: camp.id,
          type: camp.type,
          purpose: camp.purpose,
          delegation_id: camp.delegation_id,
          represented_agency_owner_id: camp.represented_agency_owner_id,
          sequencePurpose: (seq?.purpose as string | null) ?? null,
        })
        ctxCache.set(camp.id, campCtx)
      }
      await sendThroughGate({
        channel: camp.channel as 'sms' | 'email',
        to,
        subject: step.subject,
        body: tpl?.body ?? '',
        actor: 'agent:marketing_automation',
        memberId: e.member_id,
        householdId: e.household_id,
        agencyId: e.agency_id,
        entity: { type: 'campaign', id: e.campaign_id },
        templateId: step.template_id,
        campaignId: e.campaign_id,
        sequenceStep: e.current_step,
        isSecurity: false,
        recipientContext: { full_name: member?.full_name ?? null },
        purpose: campCtx.purpose,
        delegation: campCtx.delegation,
        ownership: campCtx.ownership ?? { representedAgencyId: e.agency_id },
      })
      handled++
    }

    // Advance the cursor; schedule the next step by its delay, or complete.
    const nextStep = e.current_step + 1
    if (nextStep >= steps.length) {
      await db.from('comm_campaign_enrollments').update({ status: 'completed', current_step: nextStep, last_sent_at: nowISO }).eq('id', e.id)
    } else {
      const delayDays = Number(steps[nextStep]?.delay_days ?? 0)
      const next = new Date(Date.now() + delayDays * 86400000).toISOString()
      await db.from('comm_campaign_enrollments').update({ current_step: nextStep, next_send_at: next, last_sent_at: nowISO }).eq('id', e.id)
    }
  }
  return { ok: true, handled, note: `drip-advance: ${handled} steps sent through the gate` }
}

// resume-paused — resume enrollments paused by a customer reply (§10) once resume is
// allowed: the conversation is resolved/closed, or the customer has been quiet for the
// configured period (comm_conversation_policy). The pause happens in inbound.ts; this is
// the deferred resume. Never resumes into a live, recently-active conversation.
export async function resumePausedEnrollments(): Promise<JobResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const { data: pol } = await db.from('comm_conversation_policy').select('resume_quiet_days').eq('id', 'global').maybeSingle()
  const quietDays = pol?.resume_quiet_days ?? 5

  const { data: paused } = await db
    .from('comm_campaign_enrollments')
    .select('id, member_id')
    .eq('status', 'paused_for_conversation')
    .limit(1000)

  let handled = 0
  for (const e of (paused ?? []) as Array<{ id: string; member_id: string | null }>) {
    if (!e.member_id) continue
    const [{ data: conv }, { data: lastInbound }] = await Promise.all([
      db.from('comm_conversations').select('status, last_message_at').eq('member_id', e.member_id).order('last_message_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('comm_messages').select('created_at').eq('member_id', e.member_id).eq('direction', 'inbound').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const minutesSinceLastInbound = lastInbound?.created_at
      ? Math.floor((Date.now() - Date.parse(lastInbound.created_at)) / 60000)
      : null
    const decision = evaluateResume({
      conversationStatus: conv?.status ?? 'open',
      minutesSinceLastInbound,
      resumeQuietDays: quietDays,
    })
    if (decision.resume) {
      // Re-check the paused status in the UPDATE filter (idempotent against a concurrent run).
      await db
        .from('comm_campaign_enrollments')
        .update({ status: 'enrolled', resumed_at: nowISO, next_send_at: nowISO })
        .eq('id', e.id)
        .eq('status', 'paused_for_conversation')
      await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'comm_campaign_enrollment', entityId: e.id, diff: { resumed: true, reason: decision.reason } })
      handled++
    }
  }
  return { ok: true, handled, note: `resume-paused: ${handled} enrollment(s) resumed` }
}

// workforce-orchestrator — the AI workforce's daily run. Builds the prioritized
// outreach queue from detection signals, then dispatches every enabled outreach agent
// up to its daily quota. Each send is drafted via the gateway and routes ONLY through
// sendThroughGate (consent/quiet-hours/DNC/recommendation/securities enforced). The
// whole thing is kill-switch-gated per agent + globally; a disabled agent contributes
// zero sends. Idempotent by queue_date (unique key) + per-agent dedupe in runAgent.
export async function workforceOrchestrator(): Promise<JobResult> {
  const { runWorkforce } = await import('@/lib/ai/workforce')
  const result = await runWorkforce()
  const parts = Object.entries(result.dispatch)
    .map(([k, s]) => `${k}: ${s.sent} sent/${s.blocked} blocked/${s.escalated} esc/${s.skipped} skip`)
    .join('; ')
  await writeAudit({ actor: SYSTEM, action: 'ai.run', entity: 'workforce', diff: { built: result.built.byAgent, dispatch: result.dispatch, greenzone: true } })
  return { ok: true, handled: result.totalSent, note: `workforce: ${result.built.queued} queued; ${parts}` }
}

// data-quality — reconcile unlinked agency owners into the unified Contact Center
// (merge/create/link via the shared resolution engine, non-destructive), then flag
// (not collapse) remaining data gaps: members missing contact info + duplicate
// contact groups. Idempotent: linked owners are skipped on the next run.
export async function dataQuality(): Promise<JobResult> {
  const db = getDb()
  const { reconcileAgencyOwnerContacts, countContactDuplicates } = await import('@/lib/services/dataQualityReconcile')
  const rec = await reconcileAgencyOwnerContacts()
  const { count: membersMissing } = await db.from('household_members').select('id', { count: 'exact', head: true }).is('email', null).is('phone', null)
  const duplicates = await countContactDuplicates()

  if (rec.scanned > 0) {
    await writeAudit({
      actor: SYSTEM,
      action: 'ai.run',
      entity: 'data_quality',
      diff: { owners: rec, members_missing_contact: membersMissing ?? 0, duplicate_contact_groups: duplicates },
    })
  }

  return {
    ok: true,
    handled: rec.linked,
    note: `data-quality: reconciled ${rec.scanned} owners → ${rec.merged} merged / ${rec.created} created / ${rec.review} need review; ${membersMissing ?? 0} members missing contact info; ${duplicates} duplicate contact groups flagged`,
  }
}

// backup-verify — record a backup-verification heartbeat (independent pg_dump is external).
export async function backupVerify(): Promise<JobResult> {
  const db = getDb()
  await writeAudit({ actor: SYSTEM, action: 'config.changed', entity: 'backup', diff: { job: 'backup-verify', verified_at: new Date().toISOString(), note: 'restore-test heartbeat' } })
  await db.from('activities').insert({ entity_type: 'system', kind: 'backup_verify', note: 'Backup verification heartbeat', actor: SYSTEM }).select('id').maybeSingle()
  return { ok: true, note: 'backup-verify: heartbeat recorded' }
}
