// src/lib/cross-sell-life/inbound.ts
// Cross-Sell Life response + escalation + exit service (§11/§12/§13/§14/§15). The shared inbound
// handler (lib/comms/inbound.ts) already (a) records the message, (b) pauses the running enrollment
// to paused_for_conversation, and (c) handles STOP/HELP via the keyword layer. THIS module adds the
// campaign-specific decisions that follow: mapping a classified intent to an exit / advisor
// escalation, and the downstream exits (appointment / quote / application / policy) that end the
// enrollment. Every transition writes an activity (timeline) + the append-only audit_log, preserving
// the prior state (§15). Nothing here sends outbound — the AI/advisor reply path owns that.
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { decideIntent, INTENT_EXIT_REASON, type Intent } from './conversation'

const SYSTEM = 'agent:cross_sell'
// Live/paused states from which a reply-driven transition may fire.
const OPEN_STATES = ['running', 'paused_for_conversation', 'conversation_active', 'waiting_for_advisor', 'advisor_owned']

interface EnrollmentRef { id: string; household_id: string | null; status: string; campaign_id: string }

async function loadOpenEnrollment(householdId: string, memberId?: string): Promise<EnrollmentRef | null> {
  const db = getDb()
  let q = db
    .from('xsell_life_campaign_enrollments')
    .select('id, household_id, status, campaign_id')
    .in('status', OPEN_STATES)
    .order('updated_at', { ascending: false })
    .limit(1)
  q = memberId ? q.eq('member_id', memberId) : q.eq('household_id', householdId)
  const { data } = await q.maybeSingle()
  return (data as EnrollmentRef | null) ?? null
}

async function transition(e: EnrollmentRef, patch: Record<string, unknown>, activityNote: string, auditDiff: Record<string, unknown>): Promise<void> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  await db.from('xsell_life_campaign_enrollments').update({ previous_status: e.status, updated_at: nowISO, ...patch }).eq('id', e.id).in('status', OPEN_STATES)
  await db.from('activities').insert({ entity_type: 'household', entity_id: e.household_id, kind: 'xsell_life_transition', note: activityNote, actor: SYSTEM })
  await writeAudit({ actor: SYSTEM, action: 'entity.updated', entity: 'xsell_life_campaign_enrollment', entityId: e.id, diff: { prev: e.status, ...auditDiff } })
}

export interface InboundIntentInput {
  householdId: string
  memberId?: string
  intent: Intent
  confidence: number
  /** The campaign's intent_confidence_threshold (below → advisor review). */
  threshold: number
  actor?: string
}

export interface InboundIntentResult {
  handled: boolean
  action: 'exit' | 'escalate' | 'continue' | 'none'
  status?: string
  exitReason?: string
}

/**
 * Apply a classified inbound intent to the member's open Cross-Sell Life enrollment. Terminal
 * intents (not_interested, purchased_elsewhere, wrong_number, deceased, stop) exit with the mapped
 * §15 reason; escalation intents (or low confidence, §13) hand to the advisor (waiting_for_advisor
 * + a work_task); everything else keeps the enrollment paused in conversation for the AI/advisor.
 */
export async function applyInboundIntent(input: InboundIntentInput): Promise<InboundIntentResult> {
  const e = await loadOpenEnrollment(input.householdId, input.memberId)
  if (!e) return { handled: false, action: 'none' }
  const nowISO = new Date().toISOString()

  const exitReason = INTENT_EXIT_REASON[input.intent]
  if (exitReason) {
    const status = input.intent === 'stop' || input.intent === 'deceased' ? 'suppressed' : input.intent === 'wrong_number' ? 'cancelled' : 'cancelled'
    await transition(
      e,
      { status, exit_reason: input.intent === 'stop' ? 'sms_stop' : exitReason, completed_at: nowISO },
      `Cross-Sell Life exit on intent '${input.intent}'`,
      { intent: input.intent, status, exit_reason: exitReason },
    )
    return { handled: true, action: 'exit', status, exitReason }
  }

  const decision = decideIntent(input.intent, input.confidence, input.threshold)
  if (decision.escalate) {
    const db = getDb()
    const dueAt = new Date(Date.now() + 48 * 3600000).toISOString()
    const { data: task } = await db
      .from('work_tasks')
      .insert({ title: `Cross-Sell Life escalation — ${input.intent} (advisor review)`, entity_type: 'household', entity_id: e.household_id, source: 'workflow', due_at: dueAt })
      .select('id')
      .maybeSingle()
    await db.from('xsell_life_advisor_touches').insert({ enrollment_id: e.id, touch_no: 0, task_id: task?.id ?? null, due_at: dueAt, status: 'due' }).then(() => undefined, () => undefined)
    await transition(
      e,
      { status: 'waiting_for_advisor' },
      `Cross-Sell Life escalated to advisor on intent '${input.intent}'${decision.lowConfidence ? ' (low confidence)' : ''}`,
      { intent: input.intent, escalated: true, low_confidence: decision.lowConfidence, task_id: task?.id ?? null },
    )
    return { handled: true, action: 'escalate', status: 'waiting_for_advisor' }
  }

  // Green-zone AI continuation — keep the conversation open (paused), the AI reply path owns the send.
  if (e.status === 'running' || e.status === 'paused_for_conversation') {
    await transition(e, { status: 'conversation_active' }, `Cross-Sell Life conversation active on intent '${input.intent}'`, { intent: input.intent, conversation: true })
  }
  return { handled: true, action: 'continue', status: 'conversation_active' }
}

/** Advisor accepts ownership of an escalated conversation (§14). */
export async function advisorTakeOwnership(input: { enrollmentId: string; advisor: string; actor: string }): Promise<{ ok: boolean }> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  const { data: e } = await db.from('xsell_life_campaign_enrollments').select('status').eq('id', input.enrollmentId).maybeSingle()
  if (!e) return { ok: false }
  await db.from('xsell_life_campaign_enrollments').update({ status: 'advisor_owned', previous_status: e.status, assigned_advisor: input.advisor, updated_at: nowISO }).eq('id', input.enrollmentId)
  await writeAudit({ actor: input.actor, action: 'entity.updated', entity: 'xsell_life_campaign_enrollment', entityId: input.enrollmentId, diff: { prev: e.status, advisor_owned: true, advisor: input.advisor } })
  return { ok: true }
}

/** Booking an appointment exits the campaign with outcome Appointment Booked (§11 step 12/13). */
export async function exitOnAppointment(input: { householdId: string; memberId?: string; actor?: string }): Promise<{ exited: boolean }> {
  const e = await loadOpenEnrollment(input.householdId, input.memberId)
  if (!e) return { exited: false }
  await transition(e, { status: 'appointment_scheduled', exit_reason: 'appointment_booked', completed_at: new Date().toISOString() }, 'Cross-Sell Life exit — appointment booked', { exit_reason: 'appointment_booked', by: input.actor ?? SYSTEM })
  return { exited: true }
}

export type DownstreamKind = 'quote' | 'application' | 'policy' | 'purchased_elsewhere'
const DOWNSTREAM: Record<DownstreamKind, { status: string; exit: string }> = {
  quote: { status: 'quote_requested', exit: 'quote_requested' },
  application: { status: 'application_started', exit: 'application_started' },
  policy: { status: 'policy_issued', exit: 'policy_issued' },
  purchased_elsewhere: { status: 'purchased_elsewhere', exit: 'purchased_elsewhere' },
}

/** Quote / application / policy-issued / purchased-elsewhere exits (§15 / §27 exit checks). */
export async function exitOnDownstream(input: { householdId: string; memberId?: string; kind: DownstreamKind; actor?: string }): Promise<{ exited: boolean }> {
  const e = await loadOpenEnrollment(input.householdId, input.memberId)
  if (!e) return { exited: false }
  const m = DOWNSTREAM[input.kind]
  await transition(e, { status: m.status, exit_reason: m.exit, completed_at: new Date().toISOString() }, `Cross-Sell Life exit — ${input.kind}`, { exit_reason: m.exit, by: input.actor ?? SYSTEM })
  return { exited: true }
}

/** Future follow-up (§9/§13): pause out of the active cadence with a scheduled return date. */
export async function scheduleFutureFollowUp(input: { householdId: string; memberId?: string; days: number; actor?: string }): Promise<{ ok: boolean }> {
  const e = await loadOpenEnrollment(input.householdId, input.memberId)
  if (!e) return { ok: false }
  const followUpAt = new Date(Date.now() + input.days * 86400000).toISOString().slice(0, 10)
  await transition(e, { status: 'future_follow_up', exit_reason: 'future_follow_up', future_follow_up_at: followUpAt, completed_at: new Date().toISOString() }, `Cross-Sell Life future follow-up in ${input.days}d`, { exit_reason: 'future_follow_up', follow_up_at: followUpAt })
  return { ok: true }
}
