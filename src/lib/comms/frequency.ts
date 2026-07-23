// src/lib/comms/frequency.ts
// Slice 3 — Frequency caps + campaign-priority collision (PURE). Master build §9/§10.
//
// Two pure decisions (no DB, no clock — counts + config are supplied by the caller, so
// this is unit-testable offline like gate.ts):
//   • evaluateFrequency — is this send within the configured per-recipient rate caps?
//   • evaluateCollision — should this send PAUSE because a higher-priority campaign or an
//     active conversation is underway (§10: "pause unnecessary promotional automation")?
//
// Both are OPERATIONAL limits, not compliance violations: a blocked send is a deferral/
// suppression (held or dropped for this cycle), never a hard escalation. The gate wires
// them as non-escalating blocks.

import { type MessagePurpose, isMarketingPurpose, purposePriority, yieldsTo } from './purpose'

export interface FrequencyCounts {
  smsToday: number
  sms7Days: number
  marketingEmailsToday: number
  marketingEmails7Days: number
  /** All outbound touches (any channel/purpose) in the trailing day. */
  combinedTouchesToday: number
  /** Minutes since the most recent outbound send to this recipient (null = none). */
  minutesSinceLastSend: number | null
}

export interface FrequencyCaps {
  maxSmsPerDay: number
  maxSmsPer7Days: number
  maxMarketingEmailsPerDay: number
  maxMarketingEmailsPer7Days: number
  maxCombinedTouchesPerDay: number
  minIntervalMinutes: number
}

export interface FrequencyInput {
  channel: 'sms' | 'email'
  purpose: MessagePurpose
  counts: FrequencyCounts
  caps: FrequencyCaps
}

export interface PolicyDecision {
  allowed: boolean
  reason?: string
}

const OK: PolicyDecision = { allowed: true }
const BLOCK = (reason: string): PolicyDecision => ({ allowed: false, reason })

/**
 * Decide whether a send is within the recipient's configured frequency caps. Marketing
 * email caps apply only to marketing purposes; the combined-touches + min-interval caps
 * apply to every purpose. First exceeded cap wins.
 */
export function evaluateFrequency(input: FrequencyInput): PolicyDecision {
  const { counts, caps } = input
  const marketing = isMarketingPurpose(input.purpose)

  if (counts.minutesSinceLastSend != null && counts.minutesSinceLastSend < caps.minIntervalMinutes) {
    return BLOCK(`Minimum interval not met (${counts.minutesSinceLastSend}m < ${caps.minIntervalMinutes}m).`)
  }
  if (counts.combinedTouchesToday >= caps.maxCombinedTouchesPerDay) {
    return BLOCK(`Max combined touches/day reached (${caps.maxCombinedTouchesPerDay}).`)
  }
  if (input.channel === 'sms') {
    if (counts.smsToday >= caps.maxSmsPerDay) return BLOCK(`Max SMS/day reached (${caps.maxSmsPerDay}).`)
    if (counts.sms7Days >= caps.maxSmsPer7Days) return BLOCK(`Max SMS/7 days reached (${caps.maxSmsPer7Days}).`)
  }
  if (input.channel === 'email' && marketing) {
    if (counts.marketingEmailsToday >= caps.maxMarketingEmailsPerDay) {
      return BLOCK(`Max marketing emails/day reached (${caps.maxMarketingEmailsPerDay}).`)
    }
    if (counts.marketingEmails7Days >= caps.maxMarketingEmailsPer7Days) {
      return BLOCK(`Max marketing emails/7 days reached (${caps.maxMarketingEmailsPer7Days}).`)
    }
  }
  return OK
}

export interface CollisionInput {
  candidatePurpose: MessagePurpose
  /** An open, response-driven conversation is underway (highest priority — rank 0). */
  activeConversation: boolean
  /** The purpose of the highest-priority OTHER campaign currently active for this recipient. */
  activeCampaignPurpose: MessagePurpose | null
}

// During an active conversation, only "necessary" sends proceed (service / deadline /
// appointment / transactional, priority ≤ 3). Promotional + relationship sends pause
// (§10: "pause unnecessary promotional automation").
const CONVERSATION_PROCEED_MAX_RANK = 3

/**
 * Decide whether a send should PAUSE due to a higher-priority campaign or an active
 * conversation (§10). Returns allowed=false (a pause/deferral, never an escalation) with
 * the reason. The active-conversation rule never blocks a necessary servicing/deadline
 * send; it pauses promotional/relationship automation.
 */
export function evaluateCollision(input: CollisionInput): PolicyDecision {
  if (input.activeConversation && purposePriority(input.candidatePurpose) > CONVERSATION_PROCEED_MAX_RANK) {
    return BLOCK('An active conversation is underway — promotional automation is paused until it resolves.')
  }
  if (input.activeCampaignPurpose && yieldsTo(input.candidatePurpose, input.activeCampaignPurpose)) {
    return BLOCK(`A higher-priority campaign (${input.activeCampaignPurpose}) is active — this send is paused.`)
  }
  return OK
}
