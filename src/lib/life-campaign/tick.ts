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
import { campaignDispatchContext } from '@/lib/comms/campaign'
import { smsA2pApproved } from '@/lib/comms/a2p'
import { evaluateEligibility } from './eligibility'
import { canDispatch } from './states'
import { computeTouchPlan, TOUCH_SCHEDULE, type TouchKind } from './schedule'
import { loadCampaign, loadEligibilityInput, type CampaignConfig } from './data'

const SYSTEM = 'agent:marketing_automation'

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
  let sent = 0,
    advisorTasks = 0,
    exited = 0,
    completed = 0

  for (const c of campaigns ?? []) {
    if (!canDispatch(c.status)) continue // defense in depth; only Active dispatches
    const cfg = await loadCampaign(c.id)
    if (!cfg) continue

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
      const elig = evaluateEligibility(await loadEligibilityInput(cfg, e.policy_id, e.member_id, nowISO))
      if (!elig.eligible) {
        await handleIneligible(db, e.id, elig.reasons, nowISO)
        exited++
        continue
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
    handled: sent + advisorTasks,
    note: `life-conversion-tick: ${sent} message touches sent (gated), ${advisorTasks} advisor tasks, ${exited} exited on ownership/suppression, ${completed} completed`,
  }
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
  const { data: tpl } = await db.from('comm_templates').select('body, subject, channel').eq('id', touch.template_id).maybeSingle()
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

  const outcome = await sendThroughGate({
    channel,
    to,
    subject: (tpl as { subject?: string } | null)?.subject,
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
    delegation: dispatchCtx.delegation,
    ownership: dispatchCtx.ownership ?? { representedAgencyId: e.agency_id },
    aiGenerated: touch.kind === 'ai_conversation',
  })
  await markExecution(db, e.id, touchNo, outcome.sent ? 'sent' : 'suppressed', {
    channel,
    kind: touch.kind,
    reason: outcome.reason,
    messageId: outcome.messageId,
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
