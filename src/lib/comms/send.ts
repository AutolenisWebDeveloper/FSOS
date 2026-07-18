// src/lib/comms/send.ts
// P1 send-time gate binding. Every automated SMS/email in FSOS goes through
// sendThroughGate(): it computes the 7-step gate context FRESH from the database
// AT SEND TIME (consent, DNC, recipient-local quiet hours, template approval,
// securities flag), routes the message through the dispatcher (which runs the pure
// gate and escalates on block), and records a comm_messages row with the gate
// result. There is deliberately no bypass path (WF-5 invariant).
//
// On top of the gate, this layer now also:
//   • threads the send into the ONE conversation for (channel, contact) and
//     auto-associates it to member → household → agency (full history), and
//   • personalizes merge tokens, instruments outbound EMAIL with open/click
//     tracking, captures the provider id, and writes delivery-lifecycle events.
//
// The critical guarantee is unchanged: consent/DNC/quiet-hours are re-checked here
// at send time, not just at enrollment time (WF-9 invariant).

import { getDb } from '@/lib/supabase/client'
import { dispatch, type DispatchRequest } from './dispatcher'
import type { GateResult } from './gate'
import { getOrCreateConversation, touchConversation, normalizeContact, type Channel } from './conversations'
import { recordMessageEvent } from './events'
import { personalize, type RecipientContext } from './personalize'
import { instrumentEmailHtml } from './tracking'

export interface SendContext {
  channel: Channel
  /** Recipient phone (sms) or email (email). */
  to: string
  subject?: string
  body: string
  actor: string
  /** The member this send targets (for consent lookup). */
  memberId?: string | null
  householdId?: string | null
  agencyId?: string | null
  policyId?: string | null
  /** The record this send is about (for audit + timeline linkage). */
  entity?: { type: string; id: string }
  /** Template used — must be approved to pass gate step 4. */
  templateId?: string | null
  /** Record/recipient securities flag (firewall). */
  isSecurity?: boolean
  /** Recipient IANA-ish timezone offset from UTC in hours (default Central, -6/-5). */
  utcOffsetHours?: number
  campaignId?: string | null
  campaignVariant?: string | null
  sequenceStep?: number | null
  /** Reuse an existing thread (inbound handler passes it); else resolved here. */
  conversationId?: string | null
  /** Merge-token values for personalization (green-zone content substitution). */
  recipientContext?: RecipientContext
  /** Flag AI-authored sends (still gate-checked) for audit + UI. */
  aiGenerated?: boolean
  /**
   * A 1:1 reply personally typed by an authenticated, licensed operator (the FSA
   * inbox). The human IS the content approval for gate step 4 — but recommendation
   * (5), securities (6), consent (1), quiet-hours (2), and DNC (3) are STILL
   * enforced. Never set this for bulk/automated/AI sends.
   */
  humanAuthored?: boolean
}

export interface SendOutcome {
  sent: boolean
  blocked: boolean
  gate: GateResult
  messageId?: string
  conversationId?: string
  reason?: string
}

/** Conservative Central-time offset (TX). CDT = -5, CST = -6; use -6 as the floor. */
const DEFAULT_UTC_OFFSET = -6

function recipientLocalHour(utcOffsetHours = DEFAULT_UTC_OFFSET): number {
  const utcHour = new Date().getUTCHours()
  const local = (utcHour + utcOffsetHours + 24) % 24
  return local
}

/** True if the named comm template exists and is approved (gate step 4). */
export async function isTemplateApproved(templateId: string | null | undefined): Promise<boolean> {
  if (!templateId) return false
  try {
    const { data } = await getDb()
      .from('comm_templates')
      .select('approval_status, archived_at')
      .eq('id', templateId)
      .maybeSingle()
    return data?.approval_status === 'approved' && !data?.archived_at
  } catch {
    return false
  }
}

/** Valid granted consent on this channel for this member (gate step 1). */
async function hasConsent(memberId: string | null | undefined, channel: Channel): Promise<boolean> {
  if (!memberId) return false
  try {
    const { data } = await getDb()
      .from('consents')
      .select('status')
      .eq('member_id', memberId)
      .eq('channel', channel)
      .maybeSingle()
    return data?.status === 'granted'
  } catch {
    return false
  }
}

/**
 * "Approved AI policy" for gate step 4 — the non-template path for AI-authored
 * green-zone replies (CLAUDE.md §7: "approved template OR approved AI policy").
 * A policy is approved only when BOTH kill switches are on: the global AI gateway
 * AND the conversation agent. This keeps AI auto-reply fully operator-controlled —
 * disabling either switch immediately blocks + escalates instead of sending. Note
 * this only satisfies step 4; the AI draft still must clear recommendation (5),
 * securities (6), consent (1), quiet-hours (2), and DNC (3).
 */
async function hasApprovedAiPolicy(): Promise<boolean> {
  if (process.env.AI_GATEWAY_DISABLED === '1') return false
  try {
    const db = getDb()
    const [{ data: pol }, { data: agent }] = await Promise.all([
      db.from('ai_policies').select('gateway_enabled').eq('id', 'global').maybeSingle(),
      db.from('ai_agents').select('enabled').eq('key', 'conversation').maybeSingle(),
    ])
    const gatewayOn = pol?.gateway_enabled !== false
    return gatewayOn && agent?.enabled === true
  } catch {
    return false
  }
}

/** Recipient on internal/external DNC for this channel (gate step 3). */
async function onDNC(to: string, channel: Channel): Promise<boolean> {
  try {
    const { data } = await getDb()
      .from('dnc_entries')
      .select('id')
      .eq('contact', to)
      .in('channel', [channel, 'all'])
      .limit(1)
    return Array.isArray(data) && data.length > 0
  } catch {
    // Fail safe: if we cannot verify DNC, treat as blocked (never send blindly).
    return true
  }
}

/**
 * Send one message through the full 7-step gate, computed at send time.
 * On block: dispatcher records the compliance_event + escalation; we log the
 * comm_messages row as blocked with the failing step. Never sends on block.
 */
export async function sendThroughGate(ctx: SendContext): Promise<SendOutcome> {
  const db = getDb()
  const to = normalizeContact(ctx.channel, ctx.to)

  // Resolve the conversation thread up front so we have its id for the row + tracking.
  let conversationId = ctx.conversationId ?? null
  let convMemberId = ctx.memberId ?? null
  let convHouseholdId = ctx.householdId ?? null
  let convAgencyId = ctx.agencyId ?? null
  if (!conversationId) {
    const conv = await getOrCreateConversation(ctx.channel, to)
    if (conv) {
      conversationId = conv.id
      convMemberId = convMemberId ?? conv.member_id
      convHouseholdId = convHouseholdId ?? conv.household_id
      convAgencyId = convAgencyId ?? conv.agency_id
    }
  }

  // Personalize merge tokens (safe substitution; the gate still checks the result).
  const personalized = personalize(ctx.body, ctx.recipientContext ?? {})

  // Compute the gate context FRESH (send-time re-check — WF-9 invariant). Step 4
  // is satisfied by an approved template OR, for AI-authored replies with no
  // template, an approved AI policy (both AI kill switches on).
  const [consent, dnc, templateApproved] = await Promise.all([
    hasConsent(convMemberId, ctx.channel),
    onDNC(to, ctx.channel),
    isTemplateApproved(ctx.templateId),
  ])
  const approved =
    templateApproved ||
    ctx.humanAuthored === true ||
    (ctx.aiGenerated === true && !ctx.templateId ? await hasApprovedAiPolicy() : false)

  // Pre-insert the message row (queued) so email tracking can reference its id and
  // so a blocked send is still visible in the timeline. The final status/provider
  // id are patched after dispatch.
  let messageId: string | undefined
  try {
    const { data } = await db
      .from('comm_messages')
      .insert({
        channel: ctx.channel,
        direction: 'outbound',
        recipient: to,
        subject: ctx.subject ?? null,
        body: personalized,
        delivery_status: 'queued',
        template_id: ctx.templateId ?? null,
        campaign_id: ctx.campaignId ?? null,
        campaign_variant: ctx.campaignVariant ?? null,
        sequence_step: ctx.sequenceStep ?? null,
        conversation_id: conversationId,
        member_id: convMemberId,
        household_id: convHouseholdId,
        agency_id: convAgencyId,
        policy_id: ctx.policyId ?? null,
        entity_type: ctx.entity?.type ?? (convHouseholdId ? 'household' : 'conversation'),
        entity_id: ctx.entity?.id ?? convHouseholdId ?? conversationId,
        consent_at_send: consent,
        actor: ctx.actor,
        ai_generated: ctx.aiGenerated === true,
        queued_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle()
    messageId = data?.id
  } catch {
    /* best-effort; dispatcher still writes the durable audit + escalation */
  }

  // Instrument outbound email with open/click tracking (needs the message id).
  const sendBody =
    ctx.channel === 'email' && messageId ? instrumentEmailHtml(personalized, messageId) : personalized

  const req: DispatchRequest = {
    channel: ctx.channel,
    to,
    subject: ctx.subject,
    body: sendBody,
    actor: ctx.actor,
    entity: ctx.entity ?? (conversationId ? { type: 'conversation', id: conversationId } : undefined),
    gate: {
      hasConsent: consent,
      recipientLocalHour: recipientLocalHour(ctx.utcOffsetHours),
      onDNC: dnc,
      usesApprovedTemplateOrPolicy: approved,
      isSecurity: ctx.isSecurity === true,
    },
  }

  const result = await dispatch(req)

  // Patch the pre-inserted row with the outcome + provider id.
  if (messageId) {
    try {
      await db
        .from('comm_messages')
        .update({
          delivery_status: result.sent ? 'sent' : 'blocked',
          blocked_step: result.gate.blockedStep ?? null,
          block_reason: result.gate.reason ?? null,
          provider: result.sent ? (ctx.channel === 'sms' ? 'twilio' : 'resend') : null,
          provider_id: result.providerId ?? null,
          sent_at: result.sent ? new Date().toISOString() : null,
          error: result.error ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', messageId)
    } catch {
      /* best-effort */
    }
  }

  // Record the lifecycle event + advance the thread recency.
  await recordMessageEvent({
    messageId,
    conversationId,
    campaignId: ctx.campaignId ?? null,
    event: result.sent ? 'sent' : 'failed',
    channel: ctx.channel,
    detail: result.sent ? null : result.gate.blockedStep ?? result.error ?? 'blocked',
    providerId: result.providerId ?? null,
  })
  if (result.sent && conversationId) await touchConversation(conversationId, 'outbound')

  return {
    sent: result.sent,
    blocked: !result.sent,
    gate: result.gate,
    messageId,
    conversationId: conversationId ?? undefined,
    reason: result.gate.reason,
  }
}
