// src/lib/cross-sell-life/tick.ts
// The Cross-Sell Life Campaign scheduler — the multi-channel extension of dripAdvance. It advances
// each running enrollment by AT MOST ONE due touch per run (no burst / no auto catch-up, §6),
// recomputing eligibility BEFORE every touch so a newly opened life opportunity, an opt-out, a new
// appointment, or a securities flag immediately pauses/exits the enrollment. Every client-facing
// send goes through sendMessage() — consent, quiet-hours (9am-8pm local), DNC, approved-
// template, recommendation, and the securities firewall are all enforced there, not re-implemented.
// Per-touch execution rows + a deterministic idempotency key make each touch idempotent: a touch is
// never sent twice, even after an outage replay (§6/§22).
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { sendMessage, isTemplateApproved } from '@/lib/comms/send'
import { isDeferralGateStep } from '@/lib/comms/gate'
import { campaignDispatchContext, campaignIdentityContext } from '@/lib/comms/campaign'
import { smsA2pApproved } from '@/lib/comms/a2p'
import { getOrCreateConversation } from '@/lib/comms/conversations'
import { openerClassFor } from '@/lib/comms/console'
import { parseSubjectFromBody } from '@/lib/comms/template-subject'
import { armCampaignAiConversation } from '@/lib/comms/campaign-ai'
import { evaluateEligibility } from './eligibility'
import { canDispatch } from './states'
import { computeTouchPlan, deferToBusinessDay, TOTAL_TOUCHES, type TouchKind } from './schedule'
import { loadCampaign, loadEligibilityInput, type CampaignConfig } from './data'

const SYSTEM = 'agent:cross_sell'
// The green-zone agent that responds on a Cross-Sell Life AI-conversation thread once armed.
const AI_AGENT_KEY = 'cross_sell'

interface TouchRow {
  touch_no: number
  kind: TouchKind
  template_id: string | null
  playbook_key: string | null
  asset_label: string | null
}
interface EnrollmentRow {
  id: string
  campaign_id: string
  campaign_version: number
  member_id: string | null
  household_id: string | null
  agency_id: string | null
  baseline_date: string
  current_touch_no: number
}

export interface TickResult {
  ok: boolean
  handled: number
  note: string
}

export async function crossSellLifeTick(): Promise<TickResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  const { data: campaigns } = await db.from('xsell_life_campaigns').select('id, status, version').eq('status', 'active').limit(50)
  let sent = 0,
    advisorTasks = 0,
    exited = 0,
    completed = 0

  for (const c of campaigns ?? []) {
    if (!canDispatch(c.status)) continue // defense in depth; only Active dispatches
    const cfg = await loadCampaign(c.id)
    if (!cfg) continue

    const { data: touchDefs } = await db
      .from('xsell_life_campaign_touches')
      .select('touch_no, kind, template_id, playbook_key, asset_label')
      .eq('campaign_id', c.id)
      .order('touch_no', { ascending: true })
    const touchByNo = new Map<number, TouchRow>((touchDefs ?? []).map((t) => [t.touch_no, t as TouchRow]))

    const { data: due } = await db
      .from('xsell_life_campaign_enrollments')
      .select('id, campaign_id, campaign_version, member_id, household_id, agency_id, baseline_date, current_touch_no')
      .eq('campaign_id', c.id)
      .eq('status', 'running')
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
      if (!e.member_id || !e.household_id) continue
      const nextTouchNo = e.current_touch_no + 1
      const touch = touchByNo.get(nextTouchNo)
      if (!touch) {
        await completeEnrollment(db, e.id, nowISO)
        completed++
        continue
      }

      // Re-check eligibility BEFORE the touch (§3 — ownership/consent/appointment recheck).
      const elig = evaluateEligibility(await loadEligibilityInput(cfg, e.household_id, e.member_id, nowISO, e.id))
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

      // Idempotency: claim this touch's execution row with a deterministic key. If it already
      // exists, this touch already fired (or is claimed) — advance the cursor, never send twice.
      const channelForKey = touch.kind === 'email' ? 'email' : 'sms'
      const idempotencyKey = `${e.campaign_version}:${e.id}:${nextTouchNo}:${channelForKey}`
      const { data: claimed } = await db
        .from('xsell_life_campaign_executions')
        .insert({
          enrollment_id: e.id,
          touch_no: nextTouchNo,
          kind: touch.kind,
          status: 'scheduled',
          template_id: touch.template_id,
          campaign_version: e.campaign_version,
          idempotency_key: idempotencyKey,
        })
        .select('id')
        .maybeSingle()
      const alreadyFired = !claimed

      if (!alreadyFired) {
        if (touch.kind === 'advisor_outreach') {
          await fireAdvisorTouch(db, cfg, e, nextTouchNo, touch, nowISO)
          advisorTasks++
        } else {
          const fired = await fireMessageTouch(db, cfg, e, nextTouchNo, touch, dispatchCtx, nowISO)
          if (fired === 'sent') sent++
          // DEFERRAL (configured window / business hours / frequency / A2P hold): the claim
          // was released inside fireMessageTouch and the CURSOR MUST NOT ADVANCE — the
          // enrollment's next_touch_at stays due, so the next tick re-claims and re-attempts
          // this same touch once the hold clears. Advancing here would burn the touch: the
          // execution row is gone, the cursor is past it, and nothing would ever retry — the
          // exact failure the exempt-purpose defer rule exists to prevent.
          if (fired === 'deferred') continue
        }
      }

      await advanceCursor(db, cfg, e, nextTouchNo, nowISO)
    }
  }

  return {
    ok: true,
    handled: sent + advisorTasks,
    note: `cross-sell-life-tick: ${sent} message touches sent (gated), ${advisorTasks} advisor tasks, ${exited} exited on ownership/suppression, ${completed} completed`,
  }
}

// Exported for the fail-closed regression proof (tests/campaign-template-failclosed.test.mjs),
// which drives this function with a stubbed sendMessage and asserts a null/empty/invalid
// template is skipped WITHOUT any dispatch. Not part of the module's runtime API otherwise.
export async function fireMessageTouch(
  db: ReturnType<typeof getDb>,
  cfg: CampaignConfig,
  e: EnrollmentRow,
  touchNo: number,
  touch: TouchRow,
  dispatchCtx: Awaited<ReturnType<typeof campaignDispatchContext>>,
  _nowISO: string,
): Promise<'sent' | 'blocked' | 'deferred'> {
  // Unapproved/empty template → skip the send but keep the timeline moving (never stall, §6).
  if (!touch.template_id || !(await isTemplateApproved(touch.template_id))) {
    await markExecution(db, e.id, touchNo, 'skipped', { reason: 'template_not_approved' })
    return 'blocked'
  }
  const { data: tpl } = await db.from('comm_templates').select('body, channel, version, introduces_sender').eq('id', touch.template_id).maybeSingle()
  // FAIL CLOSED (audit finding F-2b): a template that resolves null (deleted/raced since the
  // approval check above), carries a channel that is neither 'email' nor 'sms', or has an empty/
  // whitespace body must NEVER be dispatched. The old code defaulted an unknown channel to SMS and
  // sent `tpl?.body ?? ''` — the exact path that shipped 67 blank SMS. Skip the touch with an
  // actionable reason (mirrors the template_not_approved skip) rather than sending anything.
  if (!tpl || (tpl.channel !== 'email' && tpl.channel !== 'sms') || !tpl.body || tpl.body.trim() === '') {
    await markExecution(db, e.id, touchNo, 'skipped', {
      reason: !tpl
        ? 'template_unresolved'
        : tpl.channel !== 'email' && tpl.channel !== 'sms'
          ? 'template_channel_invalid'
          : 'template_body_empty',
    })
    return 'blocked'
  }
  const { data: member } = await db.from('household_members').select('email, phone, full_name').eq('id', e.member_id!).maybeSingle()
  const channel = tpl.channel as 'email' | 'sms'
  const to = channel === 'email' ? member?.email : member?.phone

  // SMS A2P hold: a DEFERRAL — release the claim and hold the cursor so the next tick
  // re-attempts once A2P approves. (The old 'scheduled' mark never re-fired: the loop
  // advanced the cursor regardless and a later re-claim conflicted on the existing row, so
  // the touch was burned despite the comment promising otherwise. The tri-state return
  // finally lets the loop honor the hold.)
  if (channel === 'sms' && !smsA2pApproved()) {
    await db.from('xsell_life_campaign_executions').delete().eq('enrollment_id', e.id).eq('touch_no', touchNo)
    return 'deferred'
  }
  if (!to) {
    await markExecution(db, e.id, touchNo, 'skipped', { reason: 'no_contact_method' })
    return 'blocked'
  }

  // AI-conversation touch: resolve/create the (channel, contact) thread so the opener lands on a
  // real conversation we can then arm for governed AI auto-reply (ADR-032 shared subsystem).
  const isAi = touch.kind === 'ai_conversation'
  const conv = isAi ? await getOrCreateConversation(channel, to) : null

  // Arm this execution for retry/dead-letter recovery (§20): the idempotency_key was stamped at
  // claim; setting next_retry_at makes a genuine send failure that leaves the row 'scheduled' visible
  // to the retry sweep + health. A successful send flips it to 'sent', which the sweep skips.
  await db
    .from('xsell_life_campaign_executions')
    .update({ next_retry_at: new Date(Date.now() + 5 * 60000).toISOString() })
    .eq('enrollment_id', e.id)
    .eq('touch_no', touchNo)

  const outcome = await sendMessage({
    channel,
    to,
    subject: channel === 'email' ? parseSubjectFromBody(tpl.body) : undefined,
    body: tpl.body,
    actor: SYSTEM,
    memberId: e.member_id,
    householdId: e.household_id,
    agencyId: e.agency_id,
    policyId: null,
    entity: { type: 'xsell_life_campaign_enrollment', id: e.id },
    templateId: touch.template_id,
    // F-1 fix: NEVER put an xsell_life_campaigns.id into comm_messages.campaign_id — that column's
    // FK targets comm_campaigns (World 1), so a World-2 id silently failed the message-of-record AND
    // event-ledger inserts for every send. Attribute the campaign via source provenance + the
    // entity linkage (entity → xsell_life_campaign_enrollment → campaign) instead.
    campaignId: null,
    sourceKind: 'campaign_asset',
    sourceCampaignKey: 'cross_sell_life',
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
  // A DEFERRAL step (gate.ts DEFERRAL_GATE_STEPS: configured window, business hours,
  // frequency, collision, A2P hold) is a self-clearing hold, not a verdict on this
  // touch. RELEASE the idempotency claim so the next tick can re-claim and re-attempt
  // it — mirroring the booking ledger's release-on-deferral — and tell the loop not to
  // advance the cursor. Everything else (a compliance block, a suppression) stays a
  // terminal 'suppressed' execution exactly as before.
  if (!outcome.sent && isDeferralGateStep(outcome.gate.blockedStep)) {
    await db.from('xsell_life_campaign_executions').delete().eq('enrollment_id', e.id).eq('touch_no', touchNo)
    return 'deferred'
  }
  await markExecution(db, e.id, touchNo, outcome.sent ? 'sent' : 'suppressed', {
    channel,
    kind: touch.kind,
    playbook_key: touch.playbook_key,
    reason: outcome.reason,
    messageId: outcome.messageId,
    template_version: (tpl as { version?: number } | null)?.version ?? null,
    ...(isAi ? { ai_armed: aiArmed } : {}),
  })
  // Record the template version used on the immutable execution row (§16).
  await db
    .from('xsell_life_campaign_executions')
    .update({ template_version: (tpl as { version?: number } | null)?.version ?? null })
    .eq('enrollment_id', e.id)
    .eq('touch_no', touchNo)
  return outcome.sent ? 'sent' : 'blocked'
}

async function fireAdvisorTouch(
  db: ReturnType<typeof getDb>,
  cfg: CampaignConfig,
  e: EnrollmentRow,
  touchNo: number,
  touch: TouchRow,
  _nowISO: string,
): Promise<void> {
  const dueAt = new Date(Date.now() + cfg.advisor_due_hours * 3600000).toISOString()
  const { data: task } = await db
    .from('work_tasks')
    .insert({
      title: `${touch.asset_label ?? 'Advisor outreach'} — Cross-Sell Life Campaign`,
      entity_type: 'household',
      entity_id: e.household_id,
      source: 'workflow',
      due_at: dueAt,
    })
    .select('id')
    .maybeSingle()
  await db.from('xsell_life_advisor_touches').insert({
    enrollment_id: e.id,
    touch_no: touchNo,
    task_id: task?.id ?? null,
    due_at: dueAt,
    status: 'due',
  })
  await markExecution(db, e.id, touchNo, 'scheduled', { kind: 'advisor_outreach', task_id: task?.id ?? null })
  await db
    .from('xsell_life_campaign_executions')
    .update({ fulfilling_task_id: task?.id ?? null })
    .eq('enrollment_id', e.id)
    .eq('touch_no', touchNo)
  await writeAudit({ actor: SYSTEM, action: 'entity.created', entity: 'work_task', entityId: task?.id ?? null, diff: { xsell_life_campaign: e.campaign_id, touch_no: touchNo } })
}

async function markExecution(db: ReturnType<typeof getDb>, enrollmentId: string, touchNo: number, status: string, detail: Record<string, unknown>): Promise<void> {
  await db
    .from('xsell_life_campaign_executions')
    .update({ status, detail, executed_at: new Date().toISOString() })
    .eq('enrollment_id', enrollmentId)
    .eq('touch_no', touchNo)
}

async function advanceCursor(db: ReturnType<typeof getDb>, cfg: CampaignConfig, e: EnrollmentRow, touchNo: number, nowISO: string): Promise<void> {
  const plan = computeTouchPlan(e.baseline_date)
  const next = plan.find((p) => p.touch_no === touchNo + 1)
  if (!next) {
    await completeEnrollment(db, e.id, nowISO)
    return
  }
  // Defer the next touch to an allowed business day (weekend/holiday), then anchor mid-day UTC so
  // the gate's recipient-local quiet-hours (9am-8pm) always pass.
  const dueDay = deferToBusinessDay(next.dueDate, {
    sendOnWeekends: cfg.send_on_weekends,
    sendOnHolidays: cfg.send_on_holidays,
    holidays: cfg.holiday_calendar,
  })
  await db
    .from('xsell_life_campaign_enrollments')
    .update({ current_touch_no: touchNo, next_touch_at: `${dueDay}T13:00:00.000Z`, updated_at: nowISO })
    .eq('id', e.id)
}

async function completeEnrollment(db: ReturnType<typeof getDb>, enrollmentId: string, nowISO: string): Promise<void> {
  await db
    .from('xsell_life_campaign_enrollments')
    .update({ status: 'completed', previous_status: 'running', exit_reason: 'campaign_completed', current_touch_no: TOTAL_TOUCHES, completed_at: nowISO, updated_at: nowISO })
    .eq('id', enrollmentId)
    .eq('status', 'running')
  await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'xsell_life_campaign_enrollment', entityId: enrollmentId, diff: { completed: true, exit_reason: 'campaign_completed' } })
}

// Map an ineligibility reason set to the correct §15 terminal state + exit reason. Ownership loss
// (a life opportunity/appointment appeared) → exit; firewall/opt-out → suppress; compliance/legal →
// compliance_hold. The campaign yields to the advisor/opportunity either way.
async function handleIneligible(db: ReturnType<typeof getDb>, enrollmentId: string, reasons: string[], nowISO: string): Promise<void> {
  let status = 'cancelled'
  let exitReason = 'administrative_closure'
  if (reasons.includes('securities_excluded') || reasons.includes('opted_out')) {
    status = 'suppressed'
    exitReason = reasons.includes('opted_out') ? 'global_suppression' : 'administrative_closure'
  } else if (reasons.includes('deceased')) {
    status = 'suppressed'; exitReason = 'deceased'
  } else if (reasons.includes('compliance_hold')) {
    status = 'compliance_hold'; exitReason = 'compliance_hold'
  } else if (reasons.includes('has_active_life_opportunity') || reasons.includes('has_active_life_application') || reasons.includes('has_active_life_policy') || reasons.includes('existing_life_appointment')) {
    status = 'cancelled'; exitReason = 'administrative_closure'
  } else if (reasons.includes('in_life_conversion') || reasons.includes('in_winback')) {
    status = 'cancelled'; exitReason = 'administrative_closure'
  }
  await db
    .from('xsell_life_campaign_enrollments')
    .update({ status, previous_status: 'running', exit_reason: exitReason, pause_reason: reasons.join(','), completed_at: nowISO, updated_at: nowISO })
    .eq('id', enrollmentId)
    .eq('status', 'running')
  await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'xsell_life_campaign_enrollment', entityId: enrollmentId, diff: { status, exit_reason: exitReason, reasons } })
}
