// src/lib/pipeline-winback/tick.ts
// The Pipeline Win-Back Campaign scheduler — the multi-channel extension of the drip engine.
// One job run does two things per ACTIVE campaign:
//   1. Daily enrollment sweep (§5): enroll up to daily_enrollment_limit fresh candidates from
//      v_pipeline_winback_due (the single eligibility source), each re-checked by enrollOpportunity.
//   2. Advance sweep: advance each active enrollment by AT MOST ONE due touch per run (no burst /
//      no auto catch-up, §5a), recomputing eligibility BEFORE every touch so a newly opened/reopened
//      opportunity, a booked appointment, a reply, or an opt-out immediately pauses/exits it
//      (advisor-ownership precedence, ADR-031).
// Every client-facing send goes through sendThroughGate() — consent, quiet-hours (9am–8pm local),
// DNC, approved-template, recommendation red-line, and the securities firewall are all enforced
// there. Per-touch execution rows make each touch idempotent: a touch is never sent twice.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { sendThroughGate, isTemplateApproved } from '@/lib/comms/send'
import { campaignDispatchContext, campaignIdentityContext } from '@/lib/comms/campaign'
import { smsA2pApproved } from '@/lib/comms/a2p'
import { getOrCreateConversation } from '@/lib/comms/conversations'
import { openerClassFor } from '@/lib/comms/console'
import { armCampaignAiConversation } from '@/lib/comms/campaign-ai'
import { canDispatch } from './engine'
import { evaluateWinbackEligibility, classifyRecheckOutcome } from './eligibility'
import { computeTouchPlan, TOUCH_SCHEDULE, type TouchKind } from './schedule'
import { loadCampaign, loadWinbackEligibilityInput, type WinbackCampaignConfig } from './data'
import { enrollOpportunity } from './enroll'

const SYSTEM = 'agent:marketing_automation'
// The green-zone agent that responds on a Pipeline Win-Back AI-conversation thread once armed.
const AI_AGENT_KEY = 'pipeline'

interface TouchRow {
  touch_no: number
  kind: TouchKind
  template_id: string | null
  asset_label: string | null
}
interface EnrollmentRow {
  id: string
  campaign_id: string
  opportunity_id: string | null
  member_id: string | null
  contact_id: string | null
  household_id: string | null
  agency_id: string | null
  baseline_date: string
  current_touch_no: number
}

export interface WinbackTickResult {
  ok: boolean
  handled: number
  note: string
}

export async function pipelineWinbackTick(): Promise<WinbackTickResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  const { data: campaigns } = await db.from('pipeline_winback_campaigns').select('id, status').eq('status', 'active').limit(50)
  let enrolled = 0,
    sent = 0,
    advisorTasks = 0,
    exited = 0,
    completed = 0

  for (const c of campaigns ?? []) {
    if (!canDispatch(c.status)) continue // defense in depth; only Active dispatches
    const cfg = await loadCampaign(c.id)
    if (!cfg) continue

    enrolled += await enrollSweep(db, cfg, nowISO)

    const { data: touchDefs } = await db
      .from('pipeline_winback_touches')
      .select('touch_no, kind, template_id, asset_label')
      .eq('campaign_id', c.id)
      .order('touch_no', { ascending: true })
    const touchByNo = new Map<number, TouchRow>((touchDefs ?? []).map((t) => [t.touch_no, t as TouchRow]))

    const { data: due } = await db
      .from('pipeline_winback_enrollments')
      .select('id, campaign_id, opportunity_id, member_id, contact_id, household_id, agency_id, baseline_date, current_touch_no')
      .eq('campaign_id', c.id)
      .eq('status', 'active')
      .lte('next_touch_at', nowISO)
      .limit(1000)

    const dispatchCtx = await campaignDispatchContext({
      id: cfg.id,
      type: 'drip',
      purpose: cfg.purpose,
      delegation_id: cfg.delegation_id,
      represented_agency_owner_id: cfg.represented_agency_owner_id,
      sequencePurpose: null,
    })

    for (const e of (due ?? []) as EnrollmentRow[]) {
      if (!e.opportunity_id) continue
      const nextTouchNo = e.current_touch_no + 1
      const touch = touchByNo.get(nextTouchNo)
      if (!touch) {
        await completeEnrollment(db, e.id, nowISO)
        completed++
        continue
      }

      // Re-check eligibility BEFORE the touch (advisor-ownership recheck / shared suppression).
      // A vanished candidate (won/deleted/no-longer-stale → no view row) yields the campaign.
      const { input, snapshot } = await loadWinbackEligibilityInput(cfg, e.opportunity_id, e.id)
      if (!snapshot) {
        await handleIneligible(db, e.id, ['no_longer_eligible'], nowISO)
        exited++
        continue
      }
      const elig = evaluateWinbackEligibility(input)
      if (!elig.eligible) {
        await handleIneligible(db, e.id, elig.reasons, nowISO)
        exited++
        continue
      }

      // Honor the staged SMS A2P hold WITHOUT consuming the touch (dripAdvance-parity, §12): if
      // SMS isn't approved yet and this is an SMS message touch, DEFER it — no execution claim and
      // no cursor advance — so it retries next run and auto-sends the moment A2P is approved,
      // instead of silently burning the touch as the cursor marches past it.
      if (touch.kind !== 'advisor_outreach' && touch.template_id && !smsA2pApproved()) {
        const { data: tpl } = await db.from('comm_templates').select('channel').eq('id', touch.template_id).maybeSingle()
        if ((tpl?.channel === 'email' ? 'email' : 'sms') === 'sms') continue
      }

      // Idempotency: claim this touch's execution row first. If it already exists, this touch
      // already fired — just advance the cursor, never send twice.
      const { data: claimed } = await db
        .from('pipeline_winback_executions')
        .insert({ enrollment_id: e.id, touch_no: nextTouchNo, kind: touch.kind, status: 'scheduled' })
        .select('id')
        .maybeSingle()
      const alreadyFired = !claimed

      if (!alreadyFired) {
        if (touch.kind === 'advisor_outreach') {
          await fireAdvisorTouch(db, cfg, e, nextTouchNo, touch, nowISO)
          advisorTasks++
        } else {
          const did = await fireMessageTouch(db, cfg, e, nextTouchNo, touch, dispatchCtx, nowISO)
          if (did) sent++
        }
      }

      await advanceCursor(db, e, nextTouchNo, nowISO)
    }
  }

  return {
    ok: true,
    handled: enrolled + sent + advisorTasks,
    note: `pipeline-winback-tick: ${enrolled} enrolled, ${sent} message touches sent (gated), ${advisorTasks} advisor tasks, ${exited} exited on ownership/suppression, ${completed} completed`,
  }
}

/** §5 daily enrollment: enroll up to (daily_enrollment_limit − already-enrolled-today) fresh
 *  candidates from the eligibility view. Each candidate is re-checked by enrollOpportunity so
 *  the view stays the single eligibility source and the duplicate guard prevents re-enrollment. */
async function enrollSweep(db: ReturnType<typeof getDb>, cfg: WinbackCampaignConfig, nowISO: string): Promise<number> {
  const startOfDay = `${nowISO.slice(0, 10)}T00:00:00.000Z`
  const { count: enrolledToday } = await db
    .from('pipeline_winback_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', cfg.id)
    .gte('created_at', startOfDay)
  const remaining = cfg.daily_enrollment_limit - (enrolledToday ?? 0)
  if (remaining <= 0) return 0

  // Over-fetch (× 3) so already-enrolled / concurrently-claimed candidates don't starve the batch.
  // Filter the view's OWN soft-suppression columns (do not reimplement its WHERE) so the sweep
  // targets the truly-eligible set; enrollOpportunity re-checks each one through the pure gate.
  const { data: candidates } = await db
    .from('v_pipeline_winback_due')
    .select('opportunity_id')
    .eq('do_not_contact', false)
    .eq('has_active_advisor_opportunity', false)
    .eq('has_upcoming_appointment', false)
    .order('stale_days', { ascending: false })
    .limit(remaining * 3)

  let enrolled = 0
  for (const cand of candidates ?? []) {
    if (enrolled >= remaining) break
    if (!cand.opportunity_id) continue
    const r = await enrollOpportunity({ campaignId: cfg.id, opportunityId: cand.opportunity_id as string, actor: SYSTEM })
    if (r.enrolled) enrolled++
  }
  return enrolled
}

async function fireMessageTouch(
  db: ReturnType<typeof getDb>,
  cfg: WinbackCampaignConfig,
  e: EnrollmentRow,
  touchNo: number,
  touch: TouchRow,
  dispatchCtx: Awaited<ReturnType<typeof campaignDispatchContext>>,
  nowISO: string,
): Promise<boolean> {
  // Unapproved/empty template → skip the send but keep the timeline moving (never stall).
  if (!touch.template_id || !(await isTemplateApproved(touch.template_id))) {
    await markExecution(db, e.id, touchNo, 'skipped', { reason: 'template_not_approved' })
    return false
  }
  const { data: tpl } = await db.from('comm_templates').select('body, subject, channel').eq('id', touch.template_id).maybeSingle()

  // Recipient: the household member if present, else the originating contact (win-back leads
  // may have a contact but no materialized member yet).
  const recipient = await resolveRecipient(db, e)
  const channel = (tpl?.channel === 'email' ? 'email' : 'sms') as 'email' | 'sms'
  const to = channel === 'email' ? recipient.email : recipient.phone

  // SMS A2P hold: leave the execution 'scheduled' and do NOT advance past it — retried next run.
  if (channel === 'sms' && !smsA2pApproved()) {
    await markExecution(db, e.id, touchNo, 'scheduled', { reason: 'sms_a2p_hold' })
    return false
  }
  if (!to) {
    await markExecution(db, e.id, touchNo, 'skipped', { reason: 'no_contact_method' })
    return false
  }

  // AI-conversation touch: resolve/create the (channel, contact) thread so the opener lands on a
  // real conversation we can then arm for governed AI auto-reply (ADR-032 shared subsystem).
  const isAi = touch.kind === 'ai_conversation'
  const conv = isAi ? await getOrCreateConversation(channel, to) : null

  // Arm this execution for retry/dead-letter recovery (§20): a genuine send failure that leaves the
  // row 'scheduled' becomes visible to the retry sweep + health panel. A successful send flips it to
  // 'sent' (the sweep only walks still-'scheduled' rows), so this never dead-letters a delivered touch.
  await db
    .from('pipeline_winback_executions')
    .update({ idempotency_key: `${e.campaign_id}:${e.id}:${touchNo}:${channel}`, next_retry_at: new Date(Date.now() + 5 * 60000).toISOString() })
    .eq('enrollment_id', e.id)
    .eq('touch_no', touchNo)

  const outcome = await sendThroughGate({
    channel,
    to,
    subject: (tpl as { subject?: string } | null)?.subject,
    body: tpl?.body ?? '',
    actor: SYSTEM,
    memberId: e.member_id,
    householdId: e.household_id,
    agencyId: e.agency_id,
    entity: { type: 'pipeline_winback_enrollment', id: e.id },
    templateId: touch.template_id,
    campaignId: e.campaign_id,
    sequenceStep: touchNo,
    isSecurity: false, // firewall re-derived server-side inside the gate; never trusted from here
    recipientContext: { full_name: recipient.full_name ?? null },
    purpose: dispatchCtx.purpose,
    identity: campaignIdentityContext(dispatchCtx.purpose),
    delegation: dispatchCtx.delegation,
    ownership: dispatchCtx.ownership ?? { representedAgencyId: e.agency_id },
    aiGenerated: isAi,
    conversationId: isAi ? conv?.id ?? null : undefined,
    aiAuthorAgentKey: isAi ? AI_AGENT_KEY : undefined,
    aiMessageClass: isAi ? openerClassFor('approved_template') : undefined,
  })
  // On a delivered AI opener, arm the thread so the client's replies are answered by the governed
  // conversation subsystem (fails closed on securities/disabled-agent — replies then escalate).
  let aiArmed = false
  if (isAi && outcome.sent && conv) {
    aiArmed = await armCampaignAiConversation(conv.id, AI_AGENT_KEY, conv.is_security, SYSTEM)
  }
  await markExecution(db, e.id, touchNo, outcome.sent ? 'sent' : 'suppressed', {
    channel,
    kind: touch.kind,
    reason: outcome.reason,
    messageId: outcome.messageId,
    ...(isAi ? { ai_armed: aiArmed } : {}),
  })
  return outcome.sent
}

async function resolveRecipient(
  db: ReturnType<typeof getDb>,
  e: EnrollmentRow,
): Promise<{ email: string | null; phone: string | null; full_name: string | null }> {
  if (e.member_id) {
    const { data: m } = await db.from('household_members').select('email, phone, full_name').eq('id', e.member_id).maybeSingle()
    if (m) return { email: m.email ?? null, phone: m.phone ?? null, full_name: m.full_name ?? null }
  }
  if (e.contact_id) {
    const { data: c } = await db.from('contacts').select('email, phone, full_name').eq('id', e.contact_id).maybeSingle()
    if (c) return { email: c.email ?? null, phone: c.phone ?? null, full_name: c.full_name ?? null }
  }
  return { email: null, phone: null, full_name: null }
}

async function fireAdvisorTouch(
  db: ReturnType<typeof getDb>,
  cfg: WinbackCampaignConfig,
  e: EnrollmentRow,
  touchNo: number,
  touch: TouchRow,
  nowISO: string,
): Promise<void> {
  const dueAt = new Date(Date.now() + cfg.advisor_due_hours * 3600000).toISOString()
  const { data: task } = await db
    .from('work_tasks')
    .insert({
      title: `${touch.asset_label ?? 'Advisor outreach'} — Win-Back Campaign`,
      entity_type: 'household',
      entity_id: e.household_id,
      source: 'workflow',
      due_at: dueAt,
    })
    .select('id')
    .maybeSingle()
  await db.from('pipeline_winback_advisor_touches').insert({
    enrollment_id: e.id,
    touch_no: touchNo,
    task_id: task?.id ?? null,
    due_at: dueAt,
    status: 'due',
  })
  await markExecution(db, e.id, touchNo, 'scheduled', { kind: 'advisor_outreach', task_id: task?.id ?? null })
  await db
    .from('pipeline_winback_executions')
    .update({ fulfilling_task_id: task?.id ?? null })
    .eq('enrollment_id', e.id)
    .eq('touch_no', touchNo)
  await writeAudit({ actor: SYSTEM, action: 'entity.created', entity: 'work_task', entityId: task?.id ?? null, diff: { pipeline_winback: e.campaign_id, touch_no: touchNo } })
}

async function markExecution(db: ReturnType<typeof getDb>, enrollmentId: string, touchNo: number, status: string, detail: Record<string, unknown>): Promise<void> {
  await db
    .from('pipeline_winback_executions')
    .update({ status, detail, executed_at: new Date().toISOString() })
    .eq('enrollment_id', enrollmentId)
    .eq('touch_no', touchNo)
}

async function advanceCursor(db: ReturnType<typeof getDb>, e: EnrollmentRow, touchNo: number, nowISO: string): Promise<void> {
  const plan = computeTouchPlan(e.baseline_date)
  const next = plan.find((p) => p.touch_no === touchNo + 1)
  if (!next) {
    await completeEnrollment(db, e.id, nowISO)
    return
  }
  await db
    .from('pipeline_winback_enrollments')
    .update({ current_touch_no: touchNo, next_touch_at: `${next.dueDate}T13:00:00.000Z`, updated_at: nowISO })
    .eq('id', e.id)
}

async function completeEnrollment(db: ReturnType<typeof getDb>, enrollmentId: string, nowISO: string): Promise<void> {
  await db
    .from('pipeline_winback_enrollments')
    .update({ status: 'completed', current_touch_no: TOUCH_SCHEDULE.length, completed_at: nowISO, updated_at: nowISO })
    .eq('id', enrollmentId)
    .eq('status', 'active')
  await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'pipeline_winback_enrollment', entityId: enrollmentId, diff: { completed: true } })
}

async function handleIneligible(db: ReturnType<typeof getDb>, enrollmentId: string, reasons: string[], nowISO: string): Promise<void> {
  // Terminal SUPPRESS / resumable PAUSE / terminal EXIT is decided by the pure classifier (ADR-018):
  // a newly-open customer conversation with no terminal-yield reason pauses (resumable) instead of
  // terminally exiting — a single reply must never strand the enrollment (it previously exited here).
  const status = classifyRecheckOutcome(reasons)
  const patch: Record<string, unknown> = { status, updated_at: nowISO }
  if (status === 'paused_for_conversation') {
    patch.paused_at = nowISO
    patch.pause_reason = reasons.join(',')
  } else {
    patch.exit_reason = reasons.join(',')
    patch.completed_at = nowISO
  }
  await db
    .from('pipeline_winback_enrollments')
    .update(patch)
    .eq('id', enrollmentId)
    .eq('status', 'active')
  await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'pipeline_winback_enrollment', entityId: enrollmentId, diff: { status, reasons } })
}
