// src/lib/comms/policy-resolver.ts
// Slice 3 — Policy-engine resolver (DB-backed). Bridges the pure cores (purpose.ts /
// frequency.ts) to the live consent store, message ledger, conversation state, and the
// editable frequency policy. send.ts calls resolveSendPolicy when a message purpose is
// supplied; the result feeds the gate (purpose-scoped consent, frequency, collision).
//
// Fails SAFE: a consent-lookup failure yields "not consented" (never send blindly); a
// frequency/collision lookup failure yields "allowed" (an operational cap must not
// silently drop a compliance-clean send — the other gate steps still protect it).

import { getDb } from '@/lib/supabase/client'
import {
  purposeToConsentPurpose,
  isMarketingPurpose,
  type MessagePurpose,
  type Channel,
} from './purpose'
import {
  evaluateFrequency,
  evaluateCollision,
  type FrequencyCaps,
  type PolicyDecision,
} from './frequency'

// Marketing purposes counted against the marketing-email caps (§9). Passed to the typed
// PostgREST `.in()` builder — NOT `.filter('purpose','in', "(...)")`, whose raw-string form
// matches the literal parenthesized text (including the quotes) and silently counts zero,
// which would let the marketing-email caps fail open.
const MARKETING_PURPOSES = ['MARKETING', 'WORKSHOP'] as const

/**
 * Purpose-scoped consent (§9). A channel-wide REVOKE is a hard FLOOR — a STOP (or any
 * channel-level revoke) can never be overridden by a purpose-scoped grant. Otherwise a
 * purpose-scoped row wins (its grant OR revoke); with no scoped row, fall back to the
 * channel-wide grant. Returns true only on an explicit granted status. Fails closed on error.
 */
export async function hasConsentForPurpose(
  memberId: string,
  channel: Channel,
  purpose: MessagePurpose,
): Promise<boolean> {
  try {
    const db = getDb()
    const consentPurpose = purposeToConsentPurpose(purpose, channel)
    const [scopedRes, channelRes] = await Promise.all([
      // Purpose-scoped row (companion table, unique per member/channel/purpose).
      db.from('comm_consent_purposes').select('status').eq('member_id', memberId).eq('channel', channel).eq('purpose', consentPurpose).maybeSingle(),
      // Channel-wide consent (consents, unique per member/channel).
      db.from('consents').select('status').eq('member_id', memberId).eq('channel', channel).maybeSingle(),
    ])
    // Channel-wide revoke is the floor: STOP/opt-out at the channel level wins over any
    // purpose-scoped grant, so the two stores can never disagree in the permissive direction.
    if (channelRes.data?.status === 'revoked') return false
    if (scopedRes.data) return scopedRes.data.status === 'granted' // scoped grant OR revoke wins
    return channelRes.data?.status === 'granted'
  } catch {
    return false
  }
}

async function loadFrequencyCaps(): Promise<{ enabled: boolean; caps: FrequencyCaps } | null> {
  try {
    const { data } = await getDb().from('comm_frequency_policy').select('*').eq('id', 'global').maybeSingle()
    if (!data) return null
    return {
      enabled: data.enabled !== false,
      caps: {
        maxSmsPerDay: data.max_sms_per_day,
        maxSmsPer7Days: data.max_sms_per_7_days,
        maxMarketingEmailsPerDay: data.max_marketing_emails_per_day,
        maxMarketingEmailsPer7Days: data.max_marketing_emails_per_7_days,
        maxCombinedTouchesPerDay: data.max_combined_touches_per_day,
        minIntervalMinutes: data.min_interval_minutes,
      },
    }
  } catch {
    return null
  }
}

/** Resolve the recipient's frequency decision from the message ledger + editable caps. */
export async function resolveFrequency(memberId: string, channel: Channel, purpose: MessagePurpose): Promise<PolicyDecision> {
  const policy = await loadFrequencyCaps()
  if (!policy || !policy.enabled) return { allowed: true }
  const now = Date.now()
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  try {
    const db = getDb()
    const base = () =>
      db.from('comm_messages').select('id', { count: 'exact', head: true }).eq('direction', 'outbound').eq('delivery_status', 'sent').eq('member_id', memberId)

    const [smsToday, sms7, mktToday, mkt7, combinedToday, lastSend] = await Promise.all([
      base().eq('channel', 'sms').gte('sent_at', dayAgo),
      base().eq('channel', 'sms').gte('sent_at', weekAgo),
      base().eq('channel', 'email').in('purpose', MARKETING_PURPOSES as unknown as string[]).gte('sent_at', dayAgo),
      base().eq('channel', 'email').in('purpose', MARKETING_PURPOSES as unknown as string[]).gte('sent_at', weekAgo),
      base().gte('sent_at', dayAgo),
      db.from('comm_messages').select('sent_at').eq('direction', 'outbound').eq('delivery_status', 'sent').eq('member_id', memberId).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const minutesSinceLastSend = lastSend.data?.sent_at
      ? Math.floor((now - Date.parse(lastSend.data.sent_at)) / 60000)
      : null
    return evaluateFrequency({
      channel,
      purpose,
      caps: policy.caps,
      counts: {
        smsToday: smsToday.count ?? 0,
        sms7Days: sms7.count ?? 0,
        marketingEmailsToday: mktToday.count ?? 0,
        marketingEmails7Days: mkt7.count ?? 0,
        combinedTouchesToday: combinedToday.count ?? 0,
        minutesSinceLastSend,
      },
    })
  } catch {
    // Fail open on a counting error — the other gate steps still protect the send.
    return { allowed: true }
  }
}

/**
 * Resolve the priority-collision decision (§10). An open conversation whose last inbound
 * is unanswered counts as an active conversation. The active higher-priority campaign
 * purpose is supplied by the caller (the campaign engine knows what else is enrolled).
 */
export async function resolveCollision(
  conversationId: string | null,
  purpose: MessagePurpose,
  activeCampaignPurpose: MessagePurpose | null,
): Promise<PolicyDecision> {
  let activeConversation = false
  try {
    if (conversationId) {
      const { data } = await getDb()
        .from('comm_conversations')
        .select('status, last_direction')
        .eq('id', conversationId)
        .maybeSingle()
      activeConversation = data?.status === 'open' && data?.last_direction === 'inbound'
    }
  } catch {
    activeConversation = false
  }
  return evaluateCollision({ candidatePurpose: purpose, activeConversation, activeCampaignPurpose })
}

export interface SendPolicyInput {
  memberId: string | null
  channel: Channel
  purpose: MessagePurpose
  conversationId: string | null
  activeCampaignPurpose?: MessagePurpose | null
}

export interface SendPolicyResult {
  /** Purpose-scoped consent (null memberId → null, caller keeps its existing consent path). */
  consentForPurpose: boolean | null
  frequency: PolicyDecision
  collision: PolicyDecision
  isMarketing: boolean
}

/** One call resolving purpose-consent + frequency + collision for the send gate. */
export async function resolveSendPolicy(input: SendPolicyInput): Promise<SendPolicyResult> {
  const [consentForPurpose, frequency, collision] = await Promise.all([
    input.memberId ? hasConsentForPurpose(input.memberId, input.channel, input.purpose) : Promise.resolve(null),
    input.memberId ? resolveFrequency(input.memberId, input.channel, input.purpose) : Promise.resolve({ allowed: true } as PolicyDecision),
    resolveCollision(input.conversationId, input.purpose, input.activeCampaignPurpose ?? null),
  ])
  return { consentForPurpose, frequency, collision, isMarketing: isMarketingPurpose(input.purpose) }
}
