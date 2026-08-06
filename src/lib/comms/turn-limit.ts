// src/lib/comms/turn-limit.ts
// Per-conversation AI turn ceiling (PURE decision + thin DB adapter). CLAUDE.md §4.2.
//
// WHY. Nothing capped how long the automation could talk to a life-insurance prospect before
// a licensed person was involved. Hand-off happened only if the model volunteered it or a
// single turn tripped the recommendation red line — but the exposure is not any one turn, it
// is the AGGREGATE: a long exchange where every message passes every check and the sum is an
// advisory relationship no licensed person ever entered. This is the deterministic bound.
//
// SINCE THE LAST HUMAN TURN, not "ever". When the FSA replies from the inbox, the budget
// resets: a licensed person has taken and returned control, which is the supervision the
// ceiling exists to force. Counting from thread creation instead would punish long, healthy,
// human-supervised relationships and would make the ceiling a one-way ratchet.
//
// HAND-OFF, NOT A STOP. Reaching the ceiling disarms the thread's auto-reply, raises an FSA
// escalation naming the reason, and audits it. The client never gets silence — the thread
// simply belongs to a person now.
//
// FAILS CLOSED. If the policy cannot be read, the ceiling is treated as REACHED and the
// conversation hands off. A limit that stops applying when it cannot be verified is not a
// limit — the same posture as the AI gateway kill switch (ai/kill-switch.ts).
//
// The decision is pure (no DB, no clock) and unit-tested offline; the loader and counter are
// thin adapters, matching gate.ts / frequency.ts / conversation-mode.ts.

import { getDb } from '@/lib/supabase/client'

/** The default applied when no policy row can be read at all (migration 104 ships 6). */
export const FALLBACK_MAX_AI_TURNS = 6

export interface TurnLimitPolicy {
  /** Ceiling on consecutive AI replies since the last human turn. */
  maxAiTurns: number
  /** A disabled row imposes no ceiling (an explicit, audited operator act). */
  enabled: boolean
  /** Which policy row supplied this (for the escalation reason + audit). */
  source: string
  isAssumption: boolean
}

export interface TurnLimitDecision {
  /** May the automation take another turn? */
  allowed: boolean
  /** AI turns already taken since the last human reply. */
  turnsTaken: number
  maxAiTurns: number
  /** Human-readable basis — recorded on the escalation and the audit entry. */
  reason: string
}

/** One outbound message row, as the counter needs to see it. */
export interface OutboundTurn {
  ai_generated?: boolean | null
  delivery_status?: string | null
}

/**
 * Count consecutive AI replies since the most recent HUMAN-authored outbound message.
 * `rows` must be the conversation's outbound messages in DESCENDING time order.
 *
 * Only SENT messages count. A blocked/held/failed draft never reached the contact, so it is
 * not a turn — otherwise a run of gate blocks would silently consume the whole budget and
 * hand off a conversation in which the automation never actually said anything.
 */
export function countAiTurnsSinceHuman(rows: OutboundTurn[]): number {
  let turns = 0
  for (const row of rows) {
    if (row.delivery_status !== 'sent') continue // never reached the contact — not a turn
    if (row.ai_generated === true) {
      turns += 1
      continue
    }
    break // a human-authored send: the FSA took control here, budget resets
  }
  return turns
}

/**
 * The pure ceiling decision. A disabled policy imposes no limit. A non-positive or
 * non-finite ceiling is treated as REACHED (fail closed) rather than as "unlimited".
 */
export function evaluateTurnLimit(input: { turnsTaken: number; policy: TurnLimitPolicy }): TurnLimitDecision {
  const { turnsTaken, policy } = input
  const max = policy.maxAiTurns

  if (!policy.enabled) {
    return { allowed: true, turnsTaken, maxAiTurns: max, reason: `turn limit disabled (${policy.source})` }
  }
  if (!Number.isFinite(max) || max < 1) {
    return {
      allowed: false,
      turnsTaken,
      maxAiTurns: max,
      reason: `turn limit could not be determined (${policy.source}) — handing off rather than continuing`,
    }
  }
  if (turnsTaken >= max) {
    return {
      allowed: false,
      turnsTaken,
      maxAiTurns: max,
      reason: `AI turn limit reached (${turnsTaken}/${max} since the last human reply, ${policy.source}) — handing off to the licensed FSA`,
    }
  }
  return {
    allowed: true,
    turnsTaken,
    maxAiTurns: max,
    reason: `within the AI turn limit (${turnsTaken}/${max}, ${policy.source})`,
  }
}

/**
 * Load the ceiling for a thread. A row keyed by the thread's bound campaign agent
 * (`comm_conversations.agent_key`) overrides `global` — the per-campaign override, expressed
 * as configuration. A missing or DISABLED per-agent row falls through to `global`.
 *
 * Fails CLOSED: if nothing can be read, returns a policy whose ceiling is 0, which
 * evaluateTurnLimit() treats as reached.
 */
export async function loadTurnLimitPolicy(agentKey?: string | null): Promise<TurnLimitPolicy> {
  const failClosed: TurnLimitPolicy = {
    maxAiTurns: 0,
    enabled: true,
    source: 'policy unavailable',
    isAssumption: true,
  }
  try {
    const db = getDb()
    const ids = agentKey ? [agentKey, 'global'] : ['global']
    const { data, error } = await db
      .from('comm_conversation_policy')
      .select('id, max_ai_turns, enabled, is_assumption')
      .in('id', ids)
    if (error) return failClosed
    const rows = (data ?? []) as { id: string; max_ai_turns: number; enabled: boolean; is_assumption: boolean }[]
    // Per-agent row wins, but only when it is enabled; otherwise fall through to global.
    const scoped = agentKey ? rows.find((r) => r.id === agentKey && r.enabled !== false) : undefined
    const global = rows.find((r) => r.id === 'global')
    const row = scoped ?? global
    if (!row) return failClosed
    return {
      maxAiTurns: Number(row.max_ai_turns),
      enabled: row.enabled !== false,
      source: `policy:${row.id}`,
      isAssumption: row.is_assumption !== false,
    }
  } catch {
    return failClosed
  }
}

/**
 * Resolve the full decision for one conversation: count the AI turns since the last human
 * reply and evaluate them against the applicable ceiling. Fails CLOSED on a counting error —
 * an unverifiable turn count hands off rather than continuing.
 */
export async function checkTurnLimit(conversationId: string, agentKey?: string | null): Promise<TurnLimitDecision> {
  const policy = await loadTurnLimitPolicy(agentKey)
  try {
    const { data, error } = await getDb()
      .from('comm_messages')
      .select('ai_generated, delivery_status')
      .eq('conversation_id', conversationId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw new Error(error.message)
    return evaluateTurnLimit({ turnsTaken: countAiTurnsSinceHuman((data ?? []) as OutboundTurn[]), policy })
  } catch {
    return {
      allowed: false,
      turnsTaken: -1,
      maxAiTurns: policy.maxAiTurns,
      reason: 'AI turn count could not be verified — handing off to the licensed FSA',
    }
  }
}
