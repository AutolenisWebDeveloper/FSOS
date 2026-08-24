// src/lib/comms/inbound.ts
// The single entry point for an inbound message (SMS from Twilio, email from a
// mail-parse webhook). It:
//   1. normalizes the contact + finds/creates the ONE conversation thread,
//   2. auto-associates it to member → household → agency,
//   3. records the inbound comm_messages row + a "replied" event (full history),
//   4. honors opt-out / opt-in keywords immediately (STOP/UNSUBSCRIBE → revoke
//      consent + add DNC; START/UNSTOP → clear DNC), and
//   5. optionally drafts + sends a green-zone AI reply through the gate when the
//      thread has AI auto-reply enabled and is not securities-flagged.
// Everything is logged; nothing is silently dropped.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import {
  getOrCreateConversation,
  touchConversation,
  normalizeContact,
  type Channel,
  type Conversation,
} from './conversations'
import { recordMessageEvent } from './events'
import { draftReply } from '@/lib/ai/responder'
import { sendThroughGate } from './send'
import { classifyKeyword, type Intent } from './keywords'
import { classifyReply } from './reply-classification'
import { checkTurnLimit, type TurnLimitDecision } from './turn-limit'
import { shouldPauseOnReply } from './conversation-mode'
import { recordConsentChange } from './consent-events'
import { detectStopAutomation } from './stop-intent'
import { applySuppression } from './suppression-admin'

export type { Intent } from './keywords'
export { classifyKeyword } from './keywords'

export interface InboundInput {
  channel: Channel
  from: string // sender address (phone/email)
  body: string
  subject?: string | null
  provider?: string | null
  providerId?: string | null
}

export interface InboundResult {
  conversationId: string | null
  messageId: string | null
  intent: Intent
  optedOut: boolean
  optedIn: boolean
  /**
   * FSOS-020 — a natural-language request to stop automated outreach ("please stop texting me",
   * "not interested") TERMINATED the member's automated campaign continuation (distinct from the
   * carrier global opt-out `optedOut`: no DNC/consent-revoke). Absorbing: no cron/tick/retry/agent
   * re-selects it, and the send gate withholds future automated sends via business suppression.
   */
  campaignTerminated: boolean
  autoReplied: boolean
  escalated: boolean
}

/** Revoke consent on this channel + add to internal DNC (STOP handling). */
async function applyOptOut(conv: Conversation, contact: string): Promise<void> {
  const db = getDb()
  try {
    if (conv.member_id) {
      await db
        .from('consents')
        .upsert(
          { member_id: conv.member_id, household_id: conv.household_id, channel: conv.channel, status: 'revoked', source: 'inbound_stop', updated_at: new Date().toISOString() },
          { onConflict: 'member_id,channel' },
        )
      // STOP is authoritative across the WHOLE consent model: also revoke every
      // purpose-scoped grant on this channel so a scoped grant can never survive a STOP
      // and re-enable sends (the resolver also treats a channel revoke as a floor, but
      // cascading keeps the two stores consistent — TCPA opt-out, §12/§4.2).
      await db
        .from('comm_consent_purposes')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('member_id', conv.member_id)
        .eq('channel', conv.channel)
    }
    await db.from('dnc_entries').upsert({ contact, channel: conv.channel, scope: 'internal', reason: 'inbound STOP' }, { onConflict: 'contact,channel' })
    // ONE consent-logging path → audit_log AND the CRM timeline (§C), anchored to the
    // member/household so the opt-out is visible on the customer 360.
    await recordConsentChange({
      actor: 'system',
      channel: conv.channel,
      newStatus: 'revoked',
      previousStatus: 'granted',
      source: 'inbound_stop',
      reason: `inbound STOP (conversation ${conv.id})`,
      memberId: conv.member_id,
      householdId: conv.household_id,
    })
  } catch {
    /* best-effort; the inbound row is already recorded */
  }
}

/**
 * A genuine customer reply pauses the member's ACTIVE drip enrollments (§10): set them to
 * PAUSED_FOR_CONVERSATION. The drip runner only advances status='enrolled', so FSOS never
 * sends a "we haven't heard back" follow-up after the customer has already replied. Paused
 * enrollments resume later per comm_conversation_policy (resumePausedEnrollments). Returns
 * the number paused.
 */
async function pauseActiveEnrollments(memberId: string, reason: string): Promise<number> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  let paused = 0
  try {
    const { data } = await db
      .from('comm_campaign_enrollments')
      .update({ status: 'paused_for_conversation', paused_at: nowISO, pause_reason: reason })
      .eq('member_id', memberId)
      .eq('status', 'enrolled')
      .select('id')
    paused += Array.isArray(data) ? data.length : 0
  } catch {
    /* best-effort */
  }
  // Multi-channel campaign timelines (Life Conversion, Pipeline Win-Back, Cross-Sell Life) pause the
  // same way so no proactive touch fires while a customer conversation is open (§13/ADR-018). Their
  // live states differ: life/winback use 'active', cross-sell uses 'running'.
  for (const [table, liveStatus] of [
    ['life_campaign_enrollments', 'active'],
    ['pipeline_winback_enrollments', 'active'],
    ['xsell_life_campaign_enrollments', 'running'],
  ] as const) {
    try {
      const patch: Record<string, unknown> = { status: 'paused_for_conversation', paused_at: nowISO, pause_reason: reason, updated_at: nowISO }
      // Only the cross-sell table carries a previous_status column (its full §15 machine).
      if (table === 'xsell_life_campaign_enrollments') patch.previous_status = liveStatus
      const { data } = await db.from(table).update(patch).eq('member_id', memberId).eq('status', liveStatus).select('id')
      paused += Array.isArray(data) ? data.length : 0
    } catch {
      /* best-effort — table/column absent tolerated */
    }
  }
  return paused
}

/**
 * TERMINATE the member's live enrollments across every campaign table — an ABSORBING state, not
 * a pause. Used by BOTH the carrier STOP path (§12, TCPA) and the natural-language stop-automation
 * path (FSOS-020).
 *
 * Pausing would be wrong in a way that matters: `resumePausedEnrollments` returns a
 * `paused_for_conversation` row to `enrolled`/live once the customer has been quiet for
 * `resume_quiet_days`, so a stop would silently re-enter the sending population. The terminal
 * states here (`opted_out` for the native drips; `exited`/`suppressed` for the three campaign
 * timelines) are NEVER selected by the resume job (it only selects `paused_for_conversation`) nor
 * by the tick engines (they only select the live status), and the `unique (campaign_id, member_id)`
 * constraint blocks re-enrollment of the same pair — so no cron, tick, retry, or eligibility pass
 * can silently resurrect it.
 *
 * `exitReason` distinguishes the cause on the campaign-timeline rows (and the native-drip
 * `suppressed_reason` carries `reason`) so a global carrier opt-out is auditable distinctly from a
 * campaign-only reply-stop. Returns how many enrollments were closed.
 */
async function terminateActiveEnrollments(memberId: string, reason: string, exitReason: string): Promise<number> {
  const db = getDb()
  const nowISO = new Date().toISOString()
  let closed = 0
  // Native drips: `opted_out` is terminal, and the resume job only ever selects
  // `paused_for_conversation`, so this can never be reinstated by automation.
  try {
    const { data } = await db
      .from('comm_campaign_enrollments')
      .update({ status: 'opted_out', suppressed_reason: reason, updated_at: nowISO })
      .in('status', ['enrolled', 'paused_for_conversation'])
      .eq('member_id', memberId)
      .select('id')
    closed += Array.isArray(data) ? data.length : 0
  } catch {
    /* best-effort — consent + DNC already block the sends */
  }
  // Campaign timelines. Life Conversion and Pipeline Win-Back use `exited`; Cross-Sell Life's
  // §15 machine has no `exited` state and uses `suppressed` for an excluded contact.
  for (const [table, terminal, live] of [
    ['life_campaign_enrollments', 'exited', ['active', 'paused_for_conversation', 'paused_by_admin']],
    ['pipeline_winback_enrollments', 'exited', ['active', 'paused_for_conversation', 'paused_by_admin']],
    [
      'xsell_life_campaign_enrollments',
      'suppressed',
      ['queued', 'scheduled', 'enrolled', 'running', 'paused_for_conversation', 'paused_by_admin', 'conversation_active'],
    ],
  ] as const) {
    try {
      const { data } = await db
        .from(table)
        .update({ status: terminal, exit_reason: exitReason, completed_at: nowISO, updated_at: nowISO })
        .in('status', live as unknown as string[])
        .eq('member_id', memberId)
        .select('id')
      closed += Array.isArray(data) ? data.length : 0
    } catch {
      /* best-effort — table/column absent tolerated */
    }
  }
  return closed
}

/**
 * CAMPAIGN-TERMINATION suppression (FSOS-020): block the contact from all automated
 * NON-transactional outreach via BUSINESS suppression (comm_client_suppressions), so the
 * canonical send gate withholds every future automated campaign/AI send even if some path
 * re-enrolls or re-queues them (retry sweeps, the AI workforce, a new campaign version). This is
 * DISTINCT from the carrier global opt-out (`applyOptOut`): it writes NO DNC and revokes NO
 * consent, so transactional/servicing messages and a human 1:1 reply remain possible. Every state
 * change goes through the audited `comm_suppression_apply` RPC. Best-effort + OBSERVABLE — any
 * failure is logged (never a silent catch); the enrollment termination + FSA escalation still
 * stand. Returns whether the suppression was applied.
 */
async function applyClientSuppression(conv: Conversation, contact: string, reason: string): Promise<boolean> {
  try {
    const db = getDb()
    // comm_client_suppressions is keyed on contacts.id — resolve it the same way the send-time
    // reader does (member → source_contact_id, else tolerant address match).
    let contactId: string | null = null
    if (conv.member_id) {
      const { data } = await db.from('household_members').select('source_contact_id').eq('id', conv.member_id).maybeSingle()
      contactId = (data?.source_contact_id as string | null) ?? null
    }
    if (!contactId) {
      if (conv.channel === 'sms') {
        const tail = contact.replace(/[^\d]/g, '').slice(-10)
        if (tail.length >= 10) {
          const { data } = await db.from('contacts').select('id').eq('phone_digits', tail).is('deleted_at', null).limit(1)
          contactId = Array.isArray(data) && data.length > 0 ? (data[0].id as string) : null
        }
      } else {
        const { data } = await db.from('contacts').select('id').eq('email_lc', contact.toLowerCase()).is('deleted_at', null).limit(1)
        contactId = Array.isArray(data) && data.length > 0 ? (data[0].id as string) : null
      }
    }
    if (!contactId) {
      // No Contact Center identity to key the individual suppression on. The enrollment
      // termination above still stands; surface the gap rather than swallow it.
      console.warn('[inbound] reply-stop: no contact id resolved — business suppression skipped', { conversation: conv.id })
      return false
    }
    const res = await applySuppression({ scope: 'client', status: 'blocked', actor: 'system', reason, contactIds: [contactId] })
    if (!res.ok) {
      console.error('[inbound] reply-stop: business suppression failed', { conversation: conv.id, error: res.error })
      return false
    }
    return true
  } catch (err) {
    console.error('[inbound] reply-stop: business suppression threw', { conversation: conv.id, error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

/** Clear internal DNC + re-grant consent (START handling). */
async function applyOptIn(conv: Conversation, contact: string): Promise<void> {
  const db = getDb()
  try {
    await db.from('dnc_entries').delete().eq('contact', contact).eq('channel', conv.channel).eq('scope', 'internal')
    if (conv.member_id) {
      await db
        .from('consents')
        .upsert(
          { member_id: conv.member_id, household_id: conv.household_id, channel: conv.channel, status: 'granted', source: 'inbound_start', updated_at: new Date().toISOString() },
          { onConflict: 'member_id,channel' },
        )
    }
    // Consent RESTORED via START: records the grant to audit_log + the CRM timeline. This
    // clears the opt-out for future manual/1:1 sends but does NOT auto-resume any paused
    // promotional enrollment — re-enrollment stays an explicit, authorized admin action.
    await recordConsentChange({
      actor: 'system',
      channel: conv.channel,
      newStatus: 'granted',
      previousStatus: 'revoked',
      source: 'inbound_start',
      reason: `inbound START (conversation ${conv.id})`,
      memberId: conv.member_id,
      householdId: conv.household_id,
    })
  } catch {
    /* best-effort */
  }
}

/**
 * Process one inbound message end-to-end. Returns what happened so the webhook can
 * respond appropriately (e.g. TwiML). Never throws to the caller.
 */
export async function processInbound(input: InboundInput): Promise<InboundResult> {
  const db = getDb()
  const contact = normalizeContact(input.channel, input.from)
  const result: InboundResult = {
    conversationId: null,
    messageId: null,
    intent: classifyKeyword(input.body),
    optedOut: false,
    optedIn: false,
    campaignTerminated: false,
    autoReplied: false,
    escalated: false,
  }

  // Idempotency: providers (Twilio, Resend) retry a webhook on any non-2xx/timeout, so
  // the same inbound message can arrive more than once. If we've already recorded this
  // provider message, short-circuit — never create a duplicate conversation message or
  // fire a second AI auto-reply (§13.10/§16.3; hard-backed by the uq_comm_messages_
  // provider_id index in migration 079).
  if (input.providerId) {
    try {
      const { data: existing } = await db
        .from('comm_messages')
        .select('id, conversation_id')
        .eq('provider_id', input.providerId)
        .maybeSingle()
      if (existing) {
        result.conversationId = (existing.conversation_id as string) ?? null
        result.messageId = existing.id as string
        return result
      }
    } catch {
      /* best-effort; the DB unique index is the hard backstop */
    }
  }

  const conv = await getOrCreateConversation(input.channel, contact)
  if (!conv) return result
  result.conversationId = conv.id

  // Record the inbound message (full history, auto-associated).
  let messageId: string | null = null
  try {
    const { data } = await db
      .from('comm_messages')
      .insert({
        channel: input.channel,
        direction: 'inbound',
        recipient: null,
        sender: contact,
        body: input.body,
        subject: input.subject ?? null,
        delivery_status: 'received',
        conversation_id: conv.id,
        member_id: conv.member_id,
        household_id: conv.household_id,
        agency_id: conv.agency_id,
        entity_type: conv.household_id ? 'household' : 'conversation',
        entity_id: conv.household_id ?? conv.id,
        provider: input.provider ?? null,
        provider_id: input.providerId ?? null,
        actor: 'contact',
      })
      .select('id')
      .maybeSingle()
    messageId = data?.id ?? null
    result.messageId = messageId
  } catch {
    /* best-effort */
  }

  await recordMessageEvent({ messageId, conversationId: conv.id, event: 'replied', channel: input.channel, detail: 'inbound' })
  await touchConversation(conv.id, 'inbound', { incrementUnread: true })
  await writeAudit({ actor: 'contact', action: 'entity.created', entity: 'comm_message', entityId: messageId, diff: { direction: 'inbound', channel: input.channel, conversation: conv.id } })

  // Keyword handling (SMS-style, also honored on email replies).
  if (result.intent === 'stop') {
    await applyOptOut(conv, contact)
    result.optedOut = true
    // Close the member's live enrollments as part of the opt-out, BEFORE returning. Consent +
    // DNC already block every send at the gate, but leaving the rows live meant the drip
    // runner kept selecting them and each attempt escalated — an opt-out generating ongoing
    // work. Terminal, never paused: a paused row would be resumed by the quiet-window job.
    if (conv.member_id) {
      const closed = await terminateActiveEnrollments(conv.member_id, `inbound STOP (conversation ${conv.id})`, 'opted_out')
      if (closed > 0) {
        await writeAudit({
          actor: 'system',
          action: 'entity.updated',
          entity: 'comm_campaign_enrollment',
          entityId: conv.member_id,
          diff: { opted_out: closed, conversation: conv.id, reason: 'inbound STOP' },
        })
      }
    }
    await recordMessageEvent({ messageId, conversationId: conv.id, event: 'unsubscribed', channel: input.channel })
    return result
  }
  if (result.intent === 'start') {
    await applyOptIn(conv, contact)
    result.optedIn = true
    return result
  }

  // FSOS-020 — a NATURAL-LANGUAGE request to stop automated outreach ("please stop texting me",
  // "remove me from your list", "not interested") is NOT a first-word carrier keyword (handled
  // above), but it MUST still terminate automated campaign continuation. This is CAMPAIGN
  // TERMINATION + HUMAN HANDOFF, distinct from the carrier global opt-out: it TERMINATES the
  // member's enrollments (an absorbing terminal state the resume-paused job + ticks never
  // re-select) AND writes BUSINESS suppression (the canonical send gate then withholds every
  // future automated send — covering retries, the AI workforce, and any re-enrollment) — WITHOUT
  // writing DNC or revoking consent, so transactional/servicing messages and a human 1:1 reply
  // remain possible. Benign conversational replies (below) still pause/resume as designed.
  const stopReq = detectStopAutomation(input.body)
  if (stopReq.matched) {
    let terminated = 0
    if (conv.member_id) {
      terminated = await terminateActiveEnrollments(conv.member_id, `reply ${stopReq.kind} (conversation ${conv.id})`, 'reply_stop_request')
    }
    const suppressed = await applyClientSuppression(conv, contact, `reply ${stopReq.kind}: ${stopReq.phrase ?? ''}`.trim())
    result.campaignTerminated = true
    await writeAudit({
      actor: 'system',
      action: 'entity.updated',
      entity: 'comm_campaign_enrollment',
      entityId: conv.member_id ?? conv.id,
      diff: { campaign_terminated: terminated, business_suppressed: suppressed, conversation: conv.id, kind: stopReq.kind, reason: 'reply_stop_request' },
    })
    // Structured observability — never logs the full message body (only the matched phrase).
    console.info('[inbound] reply-stop → campaign termination', { conversation: conv.id, kind: stopReq.kind, phrase: stopReq.phrase, enrollmentsTerminated: terminated, businessSuppressed: suppressed })
    await recordMessageEvent({ messageId, conversationId: conv.id, event: 'unsubscribed', channel: input.channel, detail: `campaign_stop:${stopReq.kind}` })
    // Human handoff — surface to the FSA queue; never auto-reply to a stop request.
    await escalateToFsa(conv, messageId, `reply_${stopReq.kind}`, stopReq.phrase ?? undefined)
    result.escalated = true
    return result
  }

  // §10 — a genuine reply (anything past the STOP/START keywords, excluding a bare HELP)
  // pauses the member's active promotional automation so no scheduled "haven't heard
  // back" message follows the customer's reply. Resumed later per the conversation policy.
  if (shouldPauseOnReply(result.intent === 'help') && conv.member_id) {
    const paused = await pauseActiveEnrollments(conv.member_id, `inbound ${input.channel} reply`)
    if (paused > 0) {
      await writeAudit({
        actor: 'system',
        action: 'entity.updated',
        entity: 'comm_campaign_enrollment',
        entityId: conv.member_id,
        diff: { paused_for_conversation: paused, conversation: conv.id, reason: 'inbound reply' },
      })
    }
  }

  // Securities-flagged threads are never auto-replied — escalate to the human FSA.
  if (conv.is_security) {
    await escalateToFsa(conv, messageId, 'securities_thread')
    result.escalated = true
    return result
  }

  // Optional green-zone AI auto-reply (opt-in per thread). Every send still passes
  // the gate; a block escalates. Threads without auto-reply just wait for Markist.
  if (conv.ai_autoreply && result.intent === 'message') {
    const handled = await tryAutoReply(conv, input, messageId)
    result.autoReplied = handled.sent
    result.escalated = handled.escalated
  } else {
    // No auto-reply: still surface the inbound to the FSA queue for a human reply.
    await escalateToFsa(conv, messageId, 'inbound_awaiting_reply')
    result.escalated = true
  }

  return result
}

/**
 * The conversation has used its AI turn budget: hand it to the licensed FSA (§4.2). This is a
 * HAND-OFF, not a stop — per-thread auto-reply is disarmed so the thread is visibly a human's
 * now (the inbox badge clears), the FSA queue gets an item naming the reason, and the audit
 * log records it. Re-arming is the FSA's explicit act via the inbox toggle.
 */
async function handOffAtTurnLimit(conv: Conversation, inboundMessageId: string | null, decision: TurnLimitDecision): Promise<void> {
  try {
    await getDb()
      .from('comm_conversations')
      .update({ ai_autoreply: false, updated_at: new Date().toISOString() })
      .eq('id', conv.id)
  } catch {
    /* best-effort — the escalation below is what brings the FSA in */
  }
  await escalateToFsa(conv, inboundMessageId, 'turn_limit', decision.reason)
}

async function tryAutoReply(conv: Conversation, input: InboundInput, inboundMessageId: string | null): Promise<{ sent: boolean; escalated: boolean }> {
  const db = getDb()

  // §4.2 — the per-conversation AI turn ceiling, checked BEFORE the model is called so a
  // hand-off costs nothing. Counted since the last human reply, so an FSA turn resets the
  // budget. Fails CLOSED: an unreadable policy or an unverifiable count hands off rather than
  // continuing. This bounds conversation DEPTH; the reply frequency cap (migration 103) bounds
  // VOLUME per contact — different axes, both escalating, neither able to end a thread quietly.
  const turnLimit = await checkTurnLimit(conv.id, conv.agent_key)
  if (!turnLimit.allowed) {
    await handOffAtTurnLimit(conv, inboundMessageId, turnLimit)
    return { sent: false, escalated: true }
  }

  // Pull recent history for context.
  const { data: hist } = await db
    .from('comm_messages')
    .select('direction, body')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: true })
    .limit(20)

  const drafted = await draftReply(conv, input.body, (hist ?? []) as { direction: string; body: string | null }[])
  if ('error' in drafted) {
    await escalateToFsa(conv, inboundMessageId, 'ai_unavailable')
    return { sent: false, escalated: true }
  }

  const to = conv.contact
  // The agent that AUTHORS this reply. A thread armed by a campaign tick or the console
  // initiator carries that campaign's agent (`pipeline`, `cross_sell`, `term_conversion`, …);
  // an inbound-initiated thread carries none and falls back to the conversation responder.
  //
  // This is what makes the per-agent kill switch real on the threads it names. Gate step 4 is
  // satisfied by hasApprovedAiPolicy(agentKey), so authoring as `conversation` regardless of
  // the binding meant disabling the `pipeline` agent did not stop replies on pipeline threads
  // — the switch named a thread it could not stop. Both the actor and the authority check now
  // resolve from the same field the turn ceiling already reads.
  const authorAgentKey = conv.agent_key || 'conversation'

  // Classify the reply for the §11 authority matrix and the §9 purpose policy. Every
  // aiGenerated send is evaluated by evaluateOutboundMessage() before dispatch, and it needs
  // BOTH a message class and a purpose: omitting either held every reply as an FSA draft
  // regardless of content. classifyReply is fail-closed — it returns a class only for a
  // narrowly recognised green-zone shape, and null (⇒ authority draft_only) for everything
  // else, so an unclassified reply is still never auto-sent (§4.2/§11).
  const classification = classifyReply({
    inboundBody: input.body,
    draft: drafted.draft,
    modelHandedOff: drafted.escalateOnly,
  })

  // Route the AI draft through the SAME gate as everything else. No approved
  // template id → gate step 4 requires an approved AI policy; the gateway kill
  // switch + approved-AI-policy check govern whether this can send.
  const outcome = await sendThroughGate({
    channel: conv.channel,
    to,
    subject: input.subject ? `Re: ${input.subject}` : undefined,
    body: drafted.draft,
    actor: `agent:${authorAgentKey}`,
    memberId: conv.member_id,
    householdId: conv.household_id,
    entity: { type: 'conversation', id: conv.id },
    isSecurity: conv.is_security,
    aiGenerated: true,
    // The per-agent kill switch that must pass gate step 4 for this reply (see above).
    aiAuthorAgentKey: authorAgentKey,
    // `undefined` is deliberate for an unclassified reply: evaluateAiAuthority() fails safe
    // to draft_only on an absent class, which is exactly the outcome we want.
    aiMessageClass: classification.messageClass ?? undefined,
    purpose: classification.purpose,
    // Bound by the reply-scoped cap row, not the drip caps (migration 103): the outreach
    // minimum-interval would otherwise stall the conversation after a single AI turn. The
    // per-day ceiling still applies, and a capped reply still escalates below.
    isConversationReply: true,
    conversationId: conv.id,
  })

  if (!outcome.sent) {
    // Carry the classification into the escalation so the FSA queue says WHY the reply was
    // held ("exchange touches pricing or premium") rather than an opaque gate step.
    //
    // A HUMAN moment — bereavement, serious illness, financial hardship, an angry message —
    // escalates under its own reason rather than the generic gate one. The distinction is not
    // cosmetic: these must be findable and answerable by a person quickly, not queued behind
    // routine content holds. The contact gets silence from the automation, which is correct
    // here — a scheduling invitation in reply to a death notification is worse than nothing.
    const step = outcome.gate.blockedStep ?? 'ai_authority'
    const reason = classification.urgent ? 'urgent_human_attention' : `gate_blocked:${step}`
    await escalateToFsa(conv, inboundMessageId, reason, classification.reason)
    return { sent: false, escalated: true }
  }
  return { sent: true, escalated: false }
}

/**
 * Create an FSA escalation (surfaces in the AI escalations queue) for a thread. `detail` is
 * the human-readable basis when there is one (the reply classification), so the queue entry
 * explains itself instead of showing only a gate step.
 */
async function escalateToFsa(
  conv: Conversation,
  messageId: string | null,
  reason: string,
  detail?: string,
): Promise<void> {
  // Attribute the escalation to the agent that OWNS the thread, matching the actor on the
  // send itself — an escalation on a pipeline thread must not read as the conversation
  // responder's, or the audit trail disagrees with the authority check that produced it.
  const actor = `agent:${conv.agent_key || 'conversation'}`
  try {
    await getDb().from('agent_actions').insert({
      kind: 'escalation',
      actor,
      outcome: 'escalated',
      target_type: 'conversation',
      target_id: conv.id,
      reason,
      note: detail
        ? `Inbound ${conv.channel} needs human attention (${reason}): ${detail}.`
        : `Inbound ${conv.channel} needs human attention (${reason}).`,
    })
    await writeAudit({ actor, action: 'ai.escalated', entity: 'conversation', entityId: conv.id, diff: { reason, detail: detail ?? null, messageId } })
  } catch {
    /* best-effort */
  }
}
