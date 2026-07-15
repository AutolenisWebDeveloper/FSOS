// src/lib/comms/send.ts
// P1 send-time gate binding. Every automated SMS/email in FSOS goes through
// sendThroughGate(): it computes the 7-step gate context FRESH from the database
// AT SEND TIME (consent, DNC, recipient-local quiet hours, template approval,
// securities flag), routes the message through the dispatcher (which runs the pure
// gate and escalates on block), and records a comm_messages row with the gate
// result. There is deliberately no bypass path (WF-5 invariant).
//
// The critical guarantee: consent/DNC/quiet-hours are re-checked here at send time,
// not just at enrollment time (WF-9 invariant). A just-revoked recipient is blocked.

import { getDb } from '@/lib/supabase/client'
import { dispatch, type DispatchRequest } from './dispatcher'
import type { GateResult } from './gate'

export interface SendContext {
  channel: 'sms' | 'email'
  /** Recipient phone (sms) or email (email). */
  to: string
  subject?: string
  body: string
  actor: string
  /** The member this send targets (for consent lookup). */
  memberId?: string | null
  householdId?: string | null
  /** The record this send is about (for audit + timeline linkage). */
  entity?: { type: string; id: string }
  /** Template used — must be approved to pass gate step 4. */
  templateId?: string | null
  /** Record/recipient securities flag (firewall). */
  isSecurity?: boolean
  /** Recipient IANA-ish timezone offset from UTC in hours (default Central, -6/-5). */
  utcOffsetHours?: number
  campaignId?: string | null
}

export interface SendOutcome {
  sent: boolean
  blocked: boolean
  gate: GateResult
  messageId?: string
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
async function hasConsent(memberId: string | null | undefined, channel: 'sms' | 'email'): Promise<boolean> {
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

/** Recipient on internal/external DNC for this channel (gate step 3). */
async function onDNC(to: string, channel: 'sms' | 'email'): Promise<boolean> {
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

  // Compute the gate context FRESH (send-time re-check — WF-9 invariant).
  const [consent, dnc, approved] = await Promise.all([
    hasConsent(ctx.memberId, ctx.channel),
    onDNC(ctx.to, ctx.channel),
    isTemplateApproved(ctx.templateId),
  ])

  const req: DispatchRequest = {
    channel: ctx.channel,
    to: ctx.to,
    subject: ctx.subject,
    body: ctx.body,
    actor: ctx.actor,
    entity: ctx.entity,
    gate: {
      hasConsent: consent,
      recipientLocalHour: recipientLocalHour(ctx.utcOffsetHours),
      onDNC: dnc,
      usesApprovedTemplateOrPolicy: approved,
      isSecurity: ctx.isSecurity === true,
    },
  }

  const result = await dispatch(req)

  // Record the message + gate result for the comms timeline (blocked never hidden).
  let messageId: string | undefined
  try {
    const { data } = await db
      .from('comm_messages')
      .insert({
        channel: ctx.channel,
        direction: 'outbound',
        recipient: ctx.to,
        body: ctx.body,
        delivery_status: result.sent ? 'sent' : 'blocked',
        template_id: ctx.templateId ?? null,
        campaign_id: ctx.campaignId ?? null,
        entity_type: ctx.entity?.type ?? null,
        entity_id: ctx.entity?.id ?? null,
        household_id: ctx.householdId ?? null,
        consent_at_send: consent,
        blocked_step: result.gate.blockedStep ?? null,
        block_reason: result.gate.reason ?? null,
        actor: ctx.actor,
        provider_id: result.providerId ?? null,
      })
      .select('id')
      .maybeSingle()
    messageId = data?.id
  } catch {
    /* best-effort; dispatcher already wrote the durable audit + escalation */
  }

  return {
    sent: result.sent,
    blocked: !result.sent,
    gate: result.gate,
    messageId,
    reason: result.gate.reason,
  }
}
