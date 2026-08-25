// src/lib/comms/events.ts
// The per-message event ledger. Delivery-status callbacks (Twilio), email events
// (Resend: delivered/opened/clicked/bounced/complained), inbound replies, and
// opt-outs all funnel through recordMessageEvent(), which appends an immutable
// comm_message_events row AND advances the parent comm_messages lifecycle columns
// (delivered_at/opened_at/clicked_at/failed_at + delivery_status). Campaign
// analytics (open/click/reply/bounce rates) read straight off this ledger.

// Relative import (not the @/ alias): events.ts is now pulled into the standalone-tsc compile
// used by the offline status proofs, which do not apply the @/* path map — the same convention
// client.ts documents for itself and gate.ts/evaluations.ts already follow.
import { getDb } from '../supabase/client'

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

/**
 * `blocked` is not a provider-delivery outcome — it is the record that the GATE (or the AI
 * authority layer) refused the send. It must survive the lifecycle event that accompanies it.
 *
 * The send path writes `delivery_status='blocked'` plus `blocked_step`, then records a
 * `failed` event for the ledger; without this rule the generic `failed` patch overwrote the
 * status, so every compliance hold rendered as "Failed" on the comms surfaces while
 * `blocked_step` still said why it was blocked. The status vocabulary was right and the data
 * under it was being clobbered.
 *
 * A blocked message never reached a provider, so no genuine provider callback can apply to
 * it. Timestamps and provider_status still record; only delivery_status is protected.
 */
const PROTECTED_STATUSES = new Set(['blocked'])

/** Terminal provider outcomes a late `sent` must never downgrade. */
const TERMINAL_STATUSES = ['delivered', 'failed', 'bounced', 'complained']

/**
 * PURE: reconcile the lifecycle patch with the row's CURRENT status.
 * Returns the patch to apply, or null when the event must not touch the row at all.
 * Unit-tested offline (tests/comms-message-status.test.mjs).
 */
export function reconcileLifecycle(
  current: string | null | undefined,
  event: MessageEvent,
  patch: Record<string, unknown>,
): Record<string, unknown> | null {
  // A late `sent` never downgrades a terminal provider outcome (pre-existing rule).
  if (event === 'sent' && current && TERMINAL_STATUSES.includes(current)) return null
  // A gate/authority block is preserved: keep the timestamps, drop the status change.
  if (current && PROTECTED_STATUSES.has(current) && 'delivery_status' in patch) {
    const { delivery_status: _dropped, ...rest } = patch
    return Object.keys(rest).length ? rest : null
  }
  return Object.keys(patch).length ? patch : null
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
    // FSOS-032: providers deliver callbacks AT LEAST ONCE. Upsert on the natural fingerprint
    // (message_id, event, provider_id) with ignoreDuplicates so a redelivered identical callback
    // is a no-op instead of a duplicate ledger row. The unique index (mig 122) is a PLAIN index —
    // NOT partial — precisely so onConflict can infer it (a partial index cannot be inferred by
    // supabase-js's onConflict). It still leaves uncorrelated events unconstrained because SQL
    // treats a tuple containing any NULL as DISTINCT: an event with a null message_id (the
    // FSOS-030 orphan window) or a null provider_id (an internal marker) never conflicts and is
    // still appended, never dropped. Do NOT convert this to a partial index — that breaks onConflict.
    await db.from('comm_message_events').upsert(
      {
        message_id: input.messageId ?? null,
        conversation_id: input.conversationId ?? null,
        campaign_id: input.campaignId ?? null,
        event: input.event,
        channel: input.channel ?? null,
        detail: input.detail ?? null,
        provider_id: input.providerId ?? null,
      },
      { onConflict: 'message_id,event,provider_id', ignoreDuplicates: true },
    )
  } catch {
    /* ledger insert best-effort */
  }

  if (input.messageId) {
    const patch = lifecyclePatch(input.event, at)
    // Read the current status whenever the event would CHANGE it, so both precedence rules
    // (terminal-beats-late-sent, and blocked-survives) are applied against real state rather
    // than assumed. Opens/clicks carry no status and skip the read entirely.
    let current: string | null = null
    if ('delivery_status' in patch) {
      const { data } = await db.from('comm_messages').select('delivery_status').eq('id', input.messageId).maybeSingle()
      current = (data?.delivery_status as string) ?? null
    }
    const resolved = reconcileLifecycle(current, input.event, patch)
    if (resolved) {
      try {
        await db.from('comm_messages').update({ ...resolved, provider_status: input.event, updated_at: at }).eq('id', input.messageId)
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Resolve a comm_messages row by its OWN id — the deterministic correlation key echoed to the
 * provider (Twilio StatusCallback `?mid=`, Resend `X-FSOS-Message-Id`) so a status callback
 * correlates even if it arrives BEFORE the post-dispatch provider_id patch, or if provider_id was
 * never captured (FSOS-030). This key exists before the provider can ever call back, so it closes
 * the orphan window that keying on provider_id alone left open.
 */
export async function findMessageById(id: string): Promise<{
  id: string
  conversation_id: string | null
  campaign_id: string | null
  channel: string
  recipient: string | null
} | null> {
  if (!id) return null
  try {
    const { data } = await getDb()
      .from('comm_messages')
      .select('id, conversation_id, campaign_id, channel, recipient')
      .eq('id', id)
      .maybeSingle()
    return data ?? null
  } catch {
    return null
  }
}

/** Resolve a comm_messages row (+ its conversation/campaign/recipient) by provider id. */
export async function findMessageByProviderId(providerId: string): Promise<{
  id: string
  conversation_id: string | null
  campaign_id: string | null
  channel: string
  recipient: string | null
} | null> {
  if (!providerId) return null
  try {
    const { data } = await getDb()
      .from('comm_messages')
      .select('id, conversation_id, campaign_id, channel, recipient')
      .eq('provider_id', providerId)
      .maybeSingle()
    return data ?? null
  } catch {
    return null
  }
}
