// src/lib/district-nurture/tick.ts
// The District Agent FS Nurture Campaign scheduler (ADR-038). One job run, per ACTIVE campaign:
//   0. Resume sweep: reactivate enrollments paused by a closed workflow (reply/meeting/referral
//      conversation now closed), NO catch-up.
//   1. Daily enrollment sweep: enroll up to daily_enrollment_limit fresh district agents from
//      v_district_nurture_candidates (the single eligibility source), each re-checked by enrollAgent.
//   2. Advance sweep: advance each active enrollment by AT MOST ONE due touch per run (no burst /
//      no auto catch-up), recomputing eligibility BEFORE every touch so an opt-out, a terminated
//      agency, or a live conversation immediately pauses/exits it.
// Every message send goes through sendMessage() — message-content, consent, quiet-hours
// (9am-8pm recipient-local), DNC, approved-template, recommendation red-line, securities firewall,
// and the SMS A2P hold are all enforced there. Per-touch execution rows make each touch idempotent.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { sendMessage, isTemplateApproved } from '@/lib/comms/send'
import { campaignDispatchContext, campaignIdentityContext } from '@/lib/comms/campaign'
import { smsA2pApproved } from '@/lib/comms/a2p'
import { parseSubjectFromBody } from '@/lib/comms/template-subject'
import { canDispatch } from './engine'
import { evaluateNurtureEligibility, classifyRecheckOutcome } from './eligibility'
import { computeTouchPlan, TOUCH_SCHEDULE, type TouchKind } from './schedule'
import { loadCampaign, loadNurtureEligibilityInput, type NurtureCampaignConfig } from './data'
import { enrollAgent } from './enroll'
import { resumeAfterWorkflow } from './inbound'

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
  agency_id: string | null
  agency_owner_id: string | null
  contact_id: string | null
  email: string | null
  phone: string | null
  baseline_date: string
  current_touch_no: number
}

export interface NurtureTickResult {
  ok: boolean
  handled: number
  note: string
}

export async function districtNurtureTick(): Promise<NurtureTickResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  const { data: campaigns } = await db.from('district_nurture_campaigns').select('id, status').eq('status', 'active').limit(50)
  let enrolled = 0,
    sent = 0,
    advisorTasks = 0,
    exited = 0,
    resumed = 0,
    completed = 0

  for (const c of campaigns ?? []) {
    if (!canDispatch(c.status)) continue // defense in depth; only Active dispatches

    const cfg = await loadCampaign(c.id)
    if (!cfg) continue

    resumed += await resumeSweep(db, c.id)
    enrolled += await enrollSweep(db, cfg, nowISO)

    const { data: touchDefs } = await db
      .from('district_nurture_touches')
      .select('touch_no, kind, template_id, asset_label')
      .eq('campaign_id', c.id)
      .order('touch_no', { ascending: true })
    const touchByNo = new Map<number, TouchRow>((touchDefs ?? []).map((t) => [t.touch_no, t as TouchRow]))

    const { data: due } = await db
      .from('district_nurture_enrollments')
      .select('id, campaign_id, agency_id, agency_owner_id, contact_id, email, phone, baseline_date, current_touch_no')
      .eq('campaign_id', c.id)
      .eq('status', 'active')
      .lte('next_touch_at', nowISO)
      .limit(1000)

    const dispatchCtx = await campaignDispatchContext({
      id: cfg.id,
      type: 'drip',
      purpose: cfg.purpose,
      delegation_id: null,
      represented_agency_owner_id: null,
      sequencePurpose: null,
    })

    for (const e of (due ?? []) as EnrollmentRow[]) {
      if (!e.agency_owner_id) continue
      const nextTouchNo = e.current_touch_no + 1
      const touch = touchByNo.get(nextTouchNo)
      if (!touch) {
        await completeEnrollment(db, e.id, nowISO)
        completed++
        continue
      }

      // Re-check eligibility BEFORE the touch (opt-out / terminated agency / live conversation).
      const { input, snapshot } = await loadNurtureEligibilityInput(cfg, e.agency_owner_id, e.id)
      if (!snapshot) {
        await handleIneligible(db, e.id, ['no_longer_eligible'], nowISO)
        exited++
        continue
      }
      const elig = evaluateNurtureEligibility(input)
      if (!elig.eligible) {
        await handleIneligible(db, e.id, elig.reasons, nowISO)
        exited++
        continue
      }

      // Honor the SMS A2P hold WITHOUT consuming the touch: defer SMS message touches so they
      // auto-send the moment A2P is approved, instead of burning the touch as the cursor advances.
      if (touch.kind !== 'advisor_outreach' && touch.template_id && !smsA2pApproved()) {
        const { data: tpl } = await db.from('comm_templates').select('channel').eq('id', touch.template_id).maybeSingle()
        if ((tpl?.channel === 'email' ? 'email' : 'sms') === 'sms') continue
      }

      // Idempotency: claim the execution row first. If it already exists, this touch already fired.
      const { data: claimed } = await db
        .from('district_nurture_executions')
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
    note: `district-nurture-tick: ${enrolled} enrolled, ${resumed} resumed, ${sent} message touches sent (gated), ${advisorTasks} live-touch tasks, ${exited} exited/paused on suppression, ${completed} completed`,
  }
}

/** Resume enrollments paused by a workflow whose conversation has since closed (no catch-up). */
async function resumeSweep(db: ReturnType<typeof getDb>, campaignId: string): Promise<number> {
  const { data: paused } = await db
    .from('district_nurture_enrollments')
    .select('id, agency_id, agency_owner_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'paused_for_conversation')
    .limit(2000)

  let resumed = 0
  for (const e of paused ?? []) {
    const agencyId = (e as { agency_id: string | null }).agency_id
    if (agencyId) {
      const { count } = await db
        .from('comm_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('agency_id', agencyId)
        .eq('status', 'open')
      if ((count ?? 0) > 0) continue // conversation still open — stay paused
    }
    const agencyOwnerId = (e as { agency_owner_id: string | null }).agency_owner_id
    if (!agencyOwnerId) continue
    const r = await resumeAfterWorkflow({ campaignId, agencyOwnerId, actor: SYSTEM })
    resumed += r.resumed
  }
  return resumed
}

/** Daily enrollment: enroll up to (daily_enrollment_limit − already-enrolled-today) fresh agents. */
async function enrollSweep(db: ReturnType<typeof getDb>, cfg: NurtureCampaignConfig, nowISO: string): Promise<number> {
  const startOfDay = `${nowISO.slice(0, 10)}T00:00:00.000Z`
  const { count: enrolledToday } = await db
    .from('district_nurture_enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', cfg.id)
    .gte('created_at', startOfDay)
  const remaining = cfg.daily_enrollment_limit - (enrolledToday ?? 0)
  if (remaining <= 0) return 0

  // Exclude agents already enrolled (live or completed) in THIS campaign from the candidate
  // pull, so the sweep advances to un-enrolled agents instead of repeatedly re-fetching the same
  // lowest-id, already-enrolled rows (the candidate view intentionally does not join enrollments,
  // since analytics counts the gross reachable population). enrollAgent still re-checks each one.
  const { data: existing } = await db
    .from('district_nurture_enrollments')
    .select('agency_owner_id')
    .eq('campaign_id', cfg.id)
    .in('status', ['active', 'paused_for_conversation', 'paused_by_admin', 'completed'])
    .limit(100000)
  const seen = new Set<string>()
  for (const r of existing ?? []) if (r.agency_owner_id) seen.add(r.agency_owner_id as string)

  let q = db
    .from('v_district_nurture_candidates')
    .select('agency_owner_id')
    .eq('reachable', true)
    .order('agency_owner_id', { ascending: true })
  if (seen.size > 0) q = q.not('agency_owner_id', 'in', `(${[...seen].join(',')})`)
  const { data: candidates } = await q.limit(remaining * 3)

  let enrolled = 0
  for (const cand of candidates ?? []) {
    if (enrolled >= remaining) break
    if (!cand.agency_owner_id) continue
    const r = await enrollAgent({ campaignId: cfg.id, agencyOwnerId: cand.agency_owner_id as string, actor: SYSTEM })
    if (r.enrolled) enrolled++
  }
  return enrolled
}

// Exported for the fail-closed regression proof: drive with a stubbed gate and assert a
// null/empty/invalid template is skipped WITHOUT any dispatch.
export async function fireMessageTouch(
  db: ReturnType<typeof getDb>,
  cfg: NurtureCampaignConfig,
  e: EnrollmentRow,
  touchNo: number,
  touch: TouchRow,
  dispatchCtx: Awaited<ReturnType<typeof campaignDispatchContext>>,
  nowISO: string,
): Promise<boolean> {
  if (!touch.template_id || !(await isTemplateApproved(touch.template_id))) {
    await markExecution(db, e.id, touchNo, 'skipped', { reason: 'template_not_approved' })
    return false
  }
  const { data: tpl } = await db.from('comm_templates').select('body, channel, introduces_sender').eq('id', touch.template_id).maybeSingle()
  // FAIL CLOSED: null/invalid-channel/empty-body templates are never dispatched.
  if (!tpl || (tpl.channel !== 'email' && tpl.channel !== 'sms') || !tpl.body || tpl.body.trim() === '') {
    await markExecution(db, e.id, touchNo, 'skipped', {
      reason: !tpl
        ? 'template_unresolved'
        : tpl.channel !== 'email' && tpl.channel !== 'sms'
          ? 'template_channel_invalid'
          : 'template_body_empty',
    })
    return false
  }

  const recipient = await resolveRecipient(db, e)
  const channel = tpl.channel as 'email' | 'sms'
  const to = channel === 'email' ? recipient.email : recipient.phone

  if (channel === 'sms' && !smsA2pApproved()) {
    await markExecution(db, e.id, touchNo, 'scheduled', { reason: 'sms_a2p_hold' })
    return false
  }
  if (!to) {
    await markExecution(db, e.id, touchNo, 'skipped', { reason: 'no_contact_method' })
    return false
  }

  // Arm for retry/dead-letter recovery: a failure that leaves the row 'scheduled' is visible to
  // the retry sweep; a successful send flips it to 'sent'.
  await db
    .from('district_nurture_executions')
    .update({ idempotency_key: `${e.campaign_id}:${e.id}:${touchNo}:${channel}`, next_retry_at: new Date(Date.now() + 5 * 60000).toISOString() })
    .eq('enrollment_id', e.id)
    .eq('touch_no', touchNo)

  const firstName = (recipient.full_name ?? '').trim().split(/\s+/)[0] || null
  const outcome = await sendMessage({
    channel,
    to,
    subject: parseSubjectFromBody(tpl.body),
    body: tpl.body,
    actor: SYSTEM,
    // Agent recipients are contact-resolvable, not household members: no memberId/householdId.
    memberId: null,
    householdId: null,
    agencyId: e.agency_id,
    entity: { type: 'district_nurture_enrollment', id: e.id },
    templateId: touch.template_id,
    // comm_messages.campaign_id FKs comm_campaigns (World 1); attribute via provenance instead.
    campaignId: null,
    sourceKind: 'campaign_asset',
    sourceCampaignKey: 'district_nurture',
    sequenceStep: touchNo,
    isSecurity: false, // firewall re-derived server-side inside the gate
    recipientContext: { full_name: recipient.full_name ?? null, first_name: firstName },
    purpose: dispatchCtx.purpose,
    identity: campaignIdentityContext(dispatchCtx.purpose, tpl?.introduces_sender === true),
    delegation: dispatchCtx.delegation,
    ownership: dispatchCtx.ownership ?? (e.agency_id ? { representedAgencyId: e.agency_id } : undefined),
  })
  await markExecution(db, e.id, touchNo, outcome.sent ? 'sent' : 'suppressed', {
    channel,
    kind: touch.kind,
    reason: outcome.reason,
    messageId: outcome.messageId,
  })
  return outcome.sent
}

async function resolveRecipient(
  db: ReturnType<typeof getDb>,
  e: EnrollmentRow,
): Promise<{ email: string | null; phone: string | null; full_name: string | null }> {
  // Prefer the reconciled contact (freshest), then the snapshot taken at enrollment.
  if (e.contact_id) {
    const { data: c } = await db.from('contacts').select('email, phone, full_name').eq('id', e.contact_id).maybeSingle()
    if (c && (c.email || c.phone)) return { email: c.email ?? null, phone: c.phone ?? null, full_name: c.full_name ?? null }
  }
  return { email: e.email ?? null, phone: e.phone ?? null, full_name: null }
}

async function fireAdvisorTouch(
  db: ReturnType<typeof getDb>,
  cfg: NurtureCampaignConfig,
  e: EnrollmentRow,
  touchNo: number,
  touch: TouchRow,
  nowISO: string,
): Promise<void> {
  const dueAt = new Date(Date.now() + cfg.advisor_due_hours * 3600000).toISOString()
  const { data: task } = await db
    .from('work_tasks')
    .insert({
      title: `${touch.asset_label ?? 'Live touchpoint'} — The Second Conversation`,
      entity_type: 'agency_partnership',
      entity_id: e.agency_id,
      source: 'workflow',
      due_at: dueAt,
      owner_scope: null,
    })
    .select('id')
    .maybeSingle()
  await db.from('district_nurture_advisor_touches').insert({
    enrollment_id: e.id,
    touch_no: touchNo,
    task_id: task?.id ?? null,
    due_at: dueAt,
    status: 'due',
  })
  await markExecution(db, e.id, touchNo, 'scheduled', { kind: 'advisor_outreach', task_id: task?.id ?? null })
  await db
    .from('district_nurture_executions')
    .update({ fulfilling_task_id: task?.id ?? null })
    .eq('enrollment_id', e.id)
    .eq('touch_no', touchNo)
  await writeAudit({ actor: SYSTEM, action: 'entity.created', entity: 'work_task', entityId: task?.id ?? null, diff: { district_nurture: e.campaign_id, touch_no: touchNo } })
}

async function markExecution(db: ReturnType<typeof getDb>, enrollmentId: string, touchNo: number, status: string, detail: Record<string, unknown>): Promise<void> {
  await db
    .from('district_nurture_executions')
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
    .from('district_nurture_enrollments')
    .update({ current_touch_no: touchNo, next_touch_at: `${next.dueDate}T13:00:00.000Z`, updated_at: nowISO })
    .eq('id', e.id)
}

async function completeEnrollment(db: ReturnType<typeof getDb>, enrollmentId: string, nowISO: string): Promise<void> {
  await db
    .from('district_nurture_enrollments')
    .update({ status: 'completed', current_touch_no: TOUCH_SCHEDULE.length, completed_at: nowISO, updated_at: nowISO })
    .eq('id', enrollmentId)
    .eq('status', 'active')
  await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'district_nurture_enrollment', entityId: enrollmentId, diff: { completed: true } })
}

async function handleIneligible(db: ReturnType<typeof getDb>, enrollmentId: string, reasons: string[], nowISO: string): Promise<void> {
  const status = classifyRecheckOutcome(reasons)
  const patch: Record<string, unknown> = { status, updated_at: nowISO }
  if (status === 'paused_for_conversation') {
    patch.paused_at = nowISO
    patch.pause_reason = reasons.join(',')
  } else {
    patch.exit_reason = reasons.join(',')
    patch.completed_at = nowISO
  }
  await db.from('district_nurture_enrollments').update(patch).eq('id', enrollmentId).eq('status', 'active')
  await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'district_nurture_enrollment', entityId: enrollmentId, diff: { status, reasons } })
}
