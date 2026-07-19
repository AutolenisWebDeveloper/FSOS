// src/lib/comms/events.ts
// The per-message event ledger. Delivery-status callbacks (Twilio), email events
// (Resend: delivered/opened/clicked/bounced/complained), inbound replies, and
// opt-outs all funnel through recordMessageEvent(), which appends an immutable
// comm_message_events row AND advances the parent comm_messages lifecycle columns
// (delivered_at/opened_at/clicked_at/failed_at + delivery_status). Campaign
// analytics (open/click/reply/bounce rates) read straight off this ledger.

import { getDb } from '@/lib/supabase/client'

export type MessageEvent =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'complained'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'unsubscribed'

// Map a provider status/event token → our normalized event. Covers Twilio message
// statuses and Resend email.* event types.
const PROVIDER_EVENT: Record<string, MessageEvent> = {
  // Twilio SMS statuses
  queued: 'queued',
  sending: 'sent',
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'failed',
  failed: 'failed',
  // Resend email events (with or without the "email." prefix)
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'sent',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

export function normalizeProviderEvent(token: string): MessageEvent | null {
  const t = (token || '').toLowerCase().trim()
  return PROVIDER_EVENT[t] ?? (PROVIDER_EVENT[`email.${t}`] ?? null)
}

// An event → the lifecycle patch it applies to the comm_messages row. Terminal
// statuses (delivered/failed/bounced) win over softer ones; opens/clicks are
// additive timestamps and never downgrade delivery_status.
function lifecyclePatch(event: MessageEvent, at: string): Record<string, unknown> {
  switch (event) {
    case 'sent':
      return { delivery_status: 'sent', sent_at: at }
    case 'delivered':
      return { delivery_status: 'delivered', delivered_at: at }
    case 'failed':
      return { delivery_status: 'failed', failed_at: at }
    case 'bounced':
      return { delivery_status: 'bounced', failed_at: at }
    case 'complained':
      return { delivery_status: 'complained' }
    case 'opened':
      return { opened_at: at }
    case 'clicked':
      return { clicked_at: at }
    default:
      return {}
  }
}

export interface RecordEventInput {
  messageId?: string | null
  conversationId?: string | null
  campaignId?: string | null
  event: MessageEvent
  channel?: string | null
  detail?: string | null
  providerId?: string | null
}

/** Append an event row and advance the parent message lifecycle. Best-effort. */
export async function recordMessageEvent(input: RecordEventInput): Promise<void> {
  const db = getDb()
  const at = new Date().toISOString()
  try {
    await db.from('comm_message_events').insert({
      message_id: input.messageId ?? null,
      conversation_id: input.conversationId ?? null,
      campaign_id: input.campaignId ?? null,
      event: input.event,
      channel: input.channel ?? null,
      detail: input.detail ?? null,
      provider_id: input.providerId ?? null,
    })
  } catch {
    /* ledger insert best-effort */
  }

  if (input.messageId) {
    const patch = lifecyclePatch(input.event, at)
    // Don't overwrite a terminal delivered/failed with an earlier "sent".
    if (input.event === 'sent') {
      const { data } = await db.from('comm_messages').select('delivery_status').eq('id', input.messageId).maybeSingle()
      if (data && ['delivered', 'failed', 'bounced', 'complained'].includes(data.delivery_status)) return
    }
    if (Object.keys(patch).length) {
      try {
        await db.from('comm_messages').update({ ...patch, provider_status: input.event, updated_at: at }).eq('id', input.messageId)
      } catch {
        /* best-effort */
      }
    }
  }
}

/** Resolve a comm_messages row (+ its conversation/campaign) by provider id. */
export async function findMessageByProviderId(providerId: string): Promise<{
  id: string
  conversation_id: string | null
  campaign_id: string | null
  channel: string
} | null> {
  if (!providerId) return null
  try {
    const { data } = await getDb()
      .from('comm_messages')
      .select('id, conversation_id, campaign_id, channel')
      .eq('provider_id', providerId)
      .maybeSingle()
    return data ?? null
  } catch {
    return null
  }
}
