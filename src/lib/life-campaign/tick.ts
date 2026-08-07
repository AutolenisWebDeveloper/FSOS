// src/lib/life-campaign/tick.ts
// The Life Conversion Campaign scheduler — the multi-channel extension of dripAdvance
// (handlers.ts). It advances each active enrollment by AT MOST ONE due touch per run (no
// burst / no auto catch-up, §4b), recomputing eligibility BEFORE every touch so a newly
// opened/reopened opportunity, an opt-out, or a securities flag immediately pauses/exits the
// enrollment (Active Opportunity Ownership). Every client-facing send goes through
// sendThroughGate() — consent, quiet-hours (9am–8pm local), DNC, approved-template,
// recommendation, and the securities firewall are all enforced there, not re-implemented.
// Per-touch execution rows make each touch idempotent: a touch is never sent twice.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { sendThroughGate, isTemplateApproved } from '@/lib/comms/send'
import { campaignDispatchContext, campaignIdentityContext } from '@/lib/comms/campaign'
import { smsA2pApproved } from '@/lib/comms/a2p'
import { getOrCreateConversation } from '@/lib/comms/conversations'
import { openerClassFor } from '@/lib/comms/console'
import { parseSubjectFromBody } from '@/lib/comms/template-subject'
import { armCampaignAiConversation } from '@/lib/comms/campaign-ai'
import { evaluateEligibility } from './eligibility'
import { canDispatch } from './states'
import { computeTouchPlan, TOUCH_SCHEDULE, type TouchKind } from './schedule'
import { loadCampaign, loadEligibilityInput, type CampaignConfig } from './data'
import { enrollContact } from './enroll'

const SYSTEM = 'agent:marketing_automation'
// The green-zone agent that responds on a Life Conversion AI-conversation thread once armed.
const AI_AGENT_KEY = 'term_conversion'

interface TouchRow {
  touch_no: number
  kind: TouchKind
  template_id: string | null
  asset_label: string | null
}
interface EnrollmentRow {
  id: string
  campaign_id: string
  member_id: string | null
  household_id: string | null
  policy_id: string | null
  agency_id: string | null
  baseline_date: string
  current_touch_no: number
}

export interface TickResult {
  ok: boolean
  handled: number
  note: string
}

export async function lifeCampaignTick(): Promise<TickResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  const { data: campaigns } = await db.from('life_campaigns').select('id, status').eq('status', 'active').limit(50)
  let enrolled = 0,
    sent = 0,
    advisorTasks = 0,
    exited = 0,
    completed = 0

  for (const c of campaigns ?? []) {
    if (!canDispatch(c.status)) continue // defense in depth; only Active dispatches
    const cfg = await loadCampaign(c.id)
    if (!cfg) continue

    // §4a daily enrollment sweep — fill the day's quota from the verified-deadline conversion
    // cohort (v_conversions_due). Without this the campaign never enrolls anyone automatically;
    // it mirrors the Pipeline Win-Back tick's enrollSweep and Cross-Sell's daily enroll job.
    // enrollContact re-checks the full eligibility gate (firewall / ownership / deadline / dup).
    enrolled += await enrollSweep(db, cfg, nowISO)

    const { data: touchDefs } = await db
      .from('life_campaign_touches')
      .select('touch_no, kind, template_id, asset_label')
      .eq('campaign_id', c.id)
      .order('touch_no', { ascending: true })
    const touchByNo = new Map<number, TouchRow>((touchDefs ?? []).map((t) => [t.touch_no, t as TouchRow]))

    const { data: due } = await db
      .from('life_campaign_enrollments')
      .select('id, campaign_id, member_id, household_id, policy_id, agency_id, baseline_date, current_touch_no')
      .eq('campaign_id', c.id)
      .eq('status', 'active')
      .lte('next_touch_at', nowISO)
      .limit(1000)

    // Cache the campaign purpose/delegation context once (most campaigns aren't delegated).
    const dispatchCtx = await campaignDispatchContext({
      id: cfg.id,
      type: 'drip',
      purpose: cfg.purpose,
      delegation_id: cfg.delegation_id,
      represented_agency_owner_id: cfg.represented_agency_owner_id,
      sequencePurpose: null,
    })

    for (const e of (due ?? []) as EnrollmentRow[]) {
      if (!e.member_id || !e.policy_id) continue
      const nextTouchNo = e.current_touch_no + 1
      const touch = touchByNo.get(nextTouchNo)
      if (!touch) {
        await completeEnrollment(db, e.id, nowISO)
        completed++
        continue
      }

      // Re-check eligibility BEFORE the touch (ownership recheck).
      const elig = evaluateEligibility(await loadEligibilityInput(cfg, e.policy_id, e.member_id, nowISO, e.id))
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

      // Idempotency: claim this touch's execution row first. If it already exists, this
      // touch already fired — just advance the cursor, never send twice.
      const { data: claimed } = await db
        .from('life_campaign_executions')
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
    note: `life-conversion-tick: ${enrolled} enrolled, ${sent} message touches sent (gated), ${advisorTasks} advisor tasks, ${exited} exited on ownership/suppression, ${completed} completed`,
  }
}

/**
 * §4a daily enrollment: enroll up to (daily_enrollment_limit − already-enrolled-today) fresh
 * candidates from the verified-deadline conversion view. The view is the single eligibility
 * source; enrollContact() re-checks each candidate through the pure gate (Active Opportunity
 * Ownership + securities firewall + suppression + cooldown + deadline-fit) and the DB unique
 * (campaign_id, member_id) is the duplicate guard, so a re-run never double-enrolls. Security-
 * flagged policies are excluded here AND fail-closed inside enrollContact.
 */
async function enrollSweep(db: ReturnType<typeof getDb>, cfg: CampaignConfig, nowISO: string): Promise<number> {
  const startOfDay = `${nowISO.slice(0, 10)}T00:00:00.000Z`
  const { count: enrolledToday } = await db
    .from('life_campaign_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', cfg.id)
    .gte('created_at', startOfDay)
  const remaining = cfg.daily_enrollment_limit - (enrolledToday ?? 0)
  if (remaining <= 0) return 0

  // Over-fetch (× 4) so already-enrolled / member-less / concurrently-claimed candidates don't
  // starve the batch. Most-urgent first (soonest verified deadline). Exclude firewall rows up
  // front (enrollContact fails them closed too). Never manufacture urgency — the view only
  // surfaces policies that carry a real conversion_deadline.
  const { data: candidates } = await db
    .from('v_conversions_due')
    .select('policy_id, household_id, days_remaining, is_security')
    .eq('is_security', false)
    .order('days_remaining', { ascending: true })
    .limit(remaining * 4)

  let enrolled = 0
  for (const cand of candidates ?? []) {
    if (enrolled >= remaining) break
    if (!cand.policy_id || !cand.household_id) continue
    // Resolve the household's primary (first-created) member as the enrollment subject; the send
    // gate still enforces per-recipient consent/quiet-hours/DNC before anything is delivered.
    const { data: member } = await db
      .from('household_members')
      .select('id')
      .eq('household_id', cand.household_id as string)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!member?.id) continue
    const r = await enrollContact({
      campaignId: cfg.id,
      memberId: member.id as string,
      policyId: cand.policy_id as string,
      actor: SYSTEM,
    })
    if (r.enrolled) enrolled++
  }
  return enrolled
}

async function fireMessageTouch(
  db: ReturnType<typeof getDb>,
  cfg: CampaignConfig,
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
  // comm_templates has no `subject` column — the subject rides on the body's leading
  // "Subject:" line (template-subject.ts). Selecting a non-existent column errors (42703),
  // which blanked the body and mis-routed every email touch into the SMS branch.
  const { data: tpl } = await db.from('comm_templates').select('body, channel, introduces_sender').eq('id', touch.template_id).maybeSingle()
  const { data: member } = await db.from('household_members').select('email, phone, full_name').eq('id', e.member_id!).maybeSingle()
  const channel = (tpl?.channel === 'email' ? 'email' : 'sms') as 'email' | 'sms'
  const to = channel === 'email' ? member?.email : member?.phone

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
    .from('life_campaign_executions')
    .update({ idempotency_key: `${e.campaign_id}:${e.id}:${touchNo}:${channel}`, next_retry_at: new Date(Date.now() + 5 * 60000).toISOString() })
    .eq('enrollment_id', e.id)
    .eq('touch_no', touchNo)

  const outcome = await sendThroughGate({
    channel,
    to,
    subject: parseSubjectFromBody(tpl?.body),
    body: tpl?.body ?? '',
    actor: SYSTEM,
    memberId: e.member_id,
    householdId: e.household_id,
    agencyId: e.agency_id,
    policyId: e.policy_id,
    entity: { type: 'life_campaign_enrollment', id: e.id },
    templateId: touch.template_id,
    campaignId: e.campaign_id,
    sequenceStep: touchNo,
    isSecurity: false, // firewall re-derived server-side inside the gate; never trusted from here
    recipientContext: { full_name: member?.full_name ?? null },
    purpose: dispatchCtx.purpose,
    // ADR-016: the first-touch assets introduce the FSA in their own approved copy, so the
    // platform records the introduction without prepending a second one (migration 105).
    identity: campaignIdentityContext(dispatchCtx.purpose, tpl?.introduces_sender === true),
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

async function fireAdvisorTouch(
  db: ReturnType<typeof getDb>,
  cfg: CampaignConfig,
  e: EnrollmentRow,
  touchNo: number,
  touch: TouchRow,
  nowISO: string,
): Promise<void> {
  const dueAt = new Date(Date.now() + cfg.advisor_due_hours * 3600000).toISOString()
  const { data: task } = await db
    .from('work_tasks')
    .insert({
      title: `${touch.asset_label ?? 'Advisor outreach'} — Life Conversion Campaign`,
      entity_type: 'household',
      entity_id: e.household_id,
      source: 'workflow',
      due_at: dueAt,
    })
    .select('id')
    .maybeSingle()
  await db.from('life_advisor_touches').insert({
    enrollment_id: e.id,
    touch_no: touchNo,
    task_id: task?.id ?? null,
    due_at: dueAt,
    status: 'due',
  })
  await markExecution(db, e.id, touchNo, 'scheduled', { kind: 'advisor_outreach', task_id: task?.id ?? null })
  await db
    .from('life_campaign_executions')
    .update({ fulfilling_task_id: task?.id ?? null })
    .eq('enrollment_id', e.id)
    .eq('touch_no', touchNo)
  await writeAudit({ actor: SYSTEM, action: 'entity.created', entity: 'work_task', entityId: task?.id ?? null, diff: { life_campaign: e.campaign_id, touch_no: touchNo } })
}

async function markExecution(db: ReturnType<typeof getDb>, enrollmentId: string, touchNo: number, status: string, detail: Record<string, unknown>): Promise<void> {
  await db
    .from('life_campaign_executions')
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
    .from('life_campaign_enrollments')
    .update({ current_touch_no: touchNo, next_touch_at: `${next.dueDate}T13:00:00.000Z`, updated_at: nowISO })
    .eq('id', e.id)
}

async function completeEnrollment(db: ReturnType<typeof getDb>, enrollmentId: string, nowISO: string): Promise<void> {
  await db
    .from('life_campaign_enrollments')
    .update({ status: 'completed', current_touch_no: TOUCH_SCHEDULE.length, completed_at: nowISO, updated_at: nowISO })
    .eq('id', enrollmentId)
    .eq('status', 'active')
  await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'life_campaign_enrollment', entityId: enrollmentId, diff: { completed: true } })
}

async function handleIneligible(db: ReturnType<typeof getDb>, enrollmentId: string, reasons: string[], nowISO: string): Promise<void> {
  // Ownership loss (an opportunity opened/reopened) or a permanent block → EXIT; securities/
  // opt-out → SUPPRESS. Either way the campaign yields to the advisor/opportunity (§13c/§4b).
  const suppress = reasons.includes('securities_excluded') || reasons.includes('opted_out')
  const status = suppress ? 'suppressed' : 'exited'
  await db
    .from('life_campaign_enrollments')
    .update({ status, exit_reason: reasons.join(','), completed_at: nowISO, updated_at: nowISO })
    .eq('id', enrollmentId)
    .eq('status', 'active')
  await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'life_campaign_enrollment', entityId: enrollmentId, diff: { status, reasons } })
}
