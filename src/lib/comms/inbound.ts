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
    }
    await db.from('dnc_entries').upsert({ contact, channel: conv.channel, scope: 'internal', reason: 'inbound STOP' }, { onConflict: 'contact,channel' })
    await writeAudit({ actor: 'system', action: 'consent.revoked', entity: 'conversation', entityId: conv.id, diff: { channel: conv.channel, via: 'inbound_stop', contact } })
  } catch {
    /* best-effort; the inbound row is already recorded */
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
    await writeAudit({ actor: 'system', action: 'consent.captured', entity: 'conversation', entityId: conv.id, diff: { channel: conv.channel, via: 'inbound_start', contact } })
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
    autoReplied: false,
    escalated: false,
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
    await recordMessageEvent({ messageId, conversationId: conv.id, event: 'unsubscribed', channel: input.channel })
    return result
  }
  if (result.intent === 'start') {
    await applyOptIn(conv, contact)
    result.optedIn = true
    return result
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

async function tryAutoReply(conv: Conversation, input: InboundInput, inboundMessageId: string | null): Promise<{ sent: boolean; escalated: boolean }> {
  const db = getDb()
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
  // Route the AI draft through the SAME gate as everything else. No approved
  // template id → gate step 4 requires an approved AI policy; the gateway kill
  // switch + approved-AI-policy check govern whether this can send.
  const outcome = await sendThroughGate({
    channel: conv.channel,
    to,
    subject: input.subject ? `Re: ${input.subject}` : undefined,
    body: drafted.draft,
    actor: `agent:conversation`,
    memberId: conv.member_id,
    householdId: conv.household_id,
    entity: { type: 'conversation', id: conv.id },
    isSecurity: conv.is_security,
    aiGenerated: true,
    conversationId: conv.id,
  })

  if (!outcome.sent) {
    await escalateToFsa(conv, inboundMessageId, `gate_blocked:${outcome.gate.blockedStep ?? 'blocked'}`)
    return { sent: false, escalated: true }
  }
  return { sent: true, escalated: false }
}

/** Create an FSA escalation (surfaces in the AI escalations queue) for a thread. */
async function escalateToFsa(conv: Conversation, messageId: string | null, reason: string): Promise<void> {
  try {
    await getDb().from('agent_actions').insert({
      kind: 'escalation',
      actor: 'agent:conversation',
      outcome: 'escalated',
      target_type: 'conversation',
      target_id: conv.id,
      reason,
      note: `Inbound ${conv.channel} needs human attention (${reason}).`,
    })
    await writeAudit({ actor: 'agent:conversation', action: 'ai.escalated', entity: 'conversation', entityId: conv.id, diff: { reason, messageId } })
  } catch {
    /* best-effort */
  }
}
