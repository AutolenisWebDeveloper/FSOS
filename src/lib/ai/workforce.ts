// src/lib/ai/workforce.ts
// The AI WORKFORCE orchestrator — the piece that makes the (previously defined but
// dormant) green-zone agent roster actually operate as employees.
//
// Two phases, both idempotent by (queue_date, agent, target):
//   buildQueue()  — from the existing detection signals (cross-sell gaps, term-
//                   conversion windows, untouched referrals), resolve each target's
//                   best contactable recipient, score + rank (lib/ai/outreach.ts, the
//                   PURE core), and persist the top `daily_target` per agent as a
//                   prioritized outreach_queue for today. Securities-flagged and
//                   uncontactable/no-consent/DNC targets are excluded here and logged.
//   runOutreachAgent() — the DURABLE agent run (finally wiring jobs/agent-runner.ts):
//                   for each queued item, draft a green-zone message via the gateway,
//                   reject any recommendation language, then send ONLY through
//                   sendThroughGate() (consent / quiet-hours / DNC / template-or-AI-
//                   policy / recommendation / securities all re-checked at send time).
//                   Every item ends sent | blocked | escalated | skipped — never
//                   silently dropped.
//
// GUARDRAILS: nothing here can send a securities message, an out-of-hours message, an
// unconsented message, a DNC message, or a recommendation — the gate is the single
// hard-block authority and this file always routes through it.

import { getDb } from '@/lib/supabase/client'
import { runAgent } from '@/jobs/agent-runner'
import { sendThroughGate } from '@/lib/comms/send'
import { searchKnowledge, renderKnowledgeContext } from '@/lib/knowledge/library'
import { containsRecommendationLanguage } from '@/lib/compliance/guardrail'
import { FINRA_DISCLAIMER } from '@/lib/compliance'
import { writeAudit } from '@/lib/audit/log'
import {
  OUTREACH_AGENTS,
  OUTREACH_PROMPTS,
  buildDraftUserContent,
  priorityOf,
  selectForQuota,
  type OutreachAgentKey,
  type OutreachCandidate,
} from '@/lib/ai/outreach'

const CAP_PER_SOURCE = 400 // safety cap on rows scanned per detection source

interface TargetRow {
  agent_key: string
  daily_target: number
  channel: 'sms' | 'email'
  enabled: boolean
}

/** Load the (editable, assumption-flagged) daily quota config, keyed by agent. */
async function loadTargets(): Promise<Record<string, TargetRow>> {
  const db = getDb()
  const { data } = await db.from('agent_daily_targets').select('agent_key, daily_target, channel, enabled')
  const out: Record<string, TargetRow> = {}
  for (const r of (data ?? []) as TargetRow[]) out[r.agent_key] = r
  return out
}

interface Recipient {
  memberId: string | null
  name: string | null
  contact: string | null
  hasConsent: boolean
  onDNC: boolean
  contactable: boolean
}

/**
 * Resolve a household's best contactable recipient on `channel`: the first member
 * with the needed contact method, plus that member's consent and the recipient's
 * DNC status. household.do_not_contact is treated as DNC (never contact).
 */
async function resolveRecipient(
  householdId: string | null,
  channel: 'sms' | 'email',
  fallbackName?: string | null,
): Promise<Recipient> {
  const empty: Recipient = { memberId: null, name: fallbackName ?? null, contact: null, hasConsent: false, onDNC: false, contactable: false }
  if (!householdId) return empty
  const db = getDb()

  const { data: hh } = await db.from('households').select('do_not_contact').eq('id', householdId).maybeSingle()
  const householdDNC = hh?.do_not_contact === true

  const { data: members } = await db
    .from('household_members')
    .select('id, full_name, email, phone')
    .eq('household_id', householdId)
    .limit(25)

  const field = channel === 'sms' ? 'phone' : 'email'
  const member = (members ?? []).find((m) => (m as Record<string, string | null>)[field])
  if (!member) return { ...empty, name: fallbackName ?? null }

  const contact = (member as Record<string, string | null>)[field] as string
  const firstName = (member.full_name || '').trim().split(/\s+/)[0] || fallbackName || null

  const [{ data: consent }, { data: dnc }] = await Promise.all([
    db.from('consents').select('status').eq('member_id', member.id).eq('channel', channel).maybeSingle(),
    db.from('dnc_entries').select('id').eq('contact', contact).in('channel', [channel, 'all']).limit(1),
  ])

  return {
    memberId: member.id,
    name: firstName,
    contact,
    hasConsent: consent?.status === 'granted',
    onDNC: householdDNC || (Array.isArray(dnc) && dnc.length > 0),
    contactable: true,
  }
}

// ─── Candidate sources (each maps a detection signal → OutreachCandidate[]) ─────

async function crossSellCandidates(channel: 'sms' | 'email'): Promise<OutreachCandidate[]> {
  const db = getDb()
  const { data } = await db
    .from('v_cross_sell_gaps')
    .select('household_id, primary_name, next_best_line, score')
    .order('score', { ascending: false })
    .limit(CAP_PER_SOURCE)
  const out: OutreachCandidate[] = []
  for (const r of data ?? []) {
    const rec = await resolveRecipient(r.household_id, channel, r.primary_name)
    out.push({
      source: 'cross_sell', agentKey: 'cross_sell', entityType: 'household', entityId: r.household_id,
      householdId: r.household_id, memberId: rec.memberId, channel,
      contactable: rec.contactable, hasConsent: rec.hasConsent, onDNC: rec.onDNC, isSecurity: false,
      signal: { gapScore: Number(r.score ?? 0) },
      reason: `Coverage-gap review invitation${r.next_best_line ? ` (open line: ${r.next_best_line})` : ''}`,
      recipientName: rec.name,
    })
  }
  return out
}

async function termConversionCandidates(channel: 'sms' | 'email'): Promise<OutreachCandidate[]> {
  const db = getDb()
  const { data } = await db
    .from('v_conversions_due')
    .select('policy_id, household_id, primary_name, is_security, days_remaining, urgency_tier')
    .neq('urgency_tier', 'beyond')
    .order('days_remaining', { ascending: true })
    .limit(CAP_PER_SOURCE)
  const out: OutreachCandidate[] = []
  for (const r of data ?? []) {
    // §2.1 firewall: securities-flagged policies are never auto-enrolled for outreach.
    if (r.is_security) {
      out.push({
        source: 'term_conversion', agentKey: 'term_conversion', entityType: 'policy', entityId: r.policy_id,
        householdId: r.household_id, memberId: null, channel,
        contactable: false, hasConsent: false, onDNC: false, isSecurity: true,
        signal: { daysRemaining: Number(r.days_remaining ?? 999) },
        reason: 'Securities-flagged — routed to human/FFS (firewall)', recipientName: r.primary_name,
      })
      continue
    }
    const rec = await resolveRecipient(r.household_id, channel, r.primary_name)
    out.push({
      source: 'term_conversion', agentKey: 'term_conversion', entityType: 'policy', entityId: r.policy_id,
      householdId: r.household_id, memberId: rec.memberId, channel,
      contactable: rec.contactable, hasConsent: rec.hasConsent, onDNC: rec.onDNC, isSecurity: false,
      signal: { daysRemaining: Number(r.days_remaining ?? 999) },
      reason: `Term-conversion window opening (${r.urgency_tier}d tier) — educational review invitation`,
      recipientName: rec.name,
    })
  }
  return out
}

async function referralFollowupCandidates(channel: 'sms' | 'email'): Promise<OutreachCandidate[]> {
  const db = getDb()
  const { data } = await db
    .from('referrals')
    .select('id, household_id, referred_name, received_at, first_touch_at, sla_due_at')
    .in('status', ['received', 'working'])
    .is('first_touch_at', null)
    .is('deleted_at', null)
    .order('received_at', { ascending: true })
    .limit(CAP_PER_SOURCE)
  const now = Date.now()
  const out: OutreachCandidate[] = []
  for (const r of data ?? []) {
    const rec = await resolveRecipient(r.household_id, channel, r.referred_name)
    const ageHours = r.received_at ? (now - new Date(r.received_at).getTime()) / 3600000 : 0
    const slaBreached = !!(r.sla_due_at && new Date(r.sla_due_at).getTime() < now)
    out.push({
      source: 'referral_followup', agentKey: 'referral_followup', entityType: 'referral', entityId: r.id,
      householdId: r.household_id, memberId: rec.memberId, channel,
      contactable: rec.contactable, hasConsent: rec.hasConsent, onDNC: rec.onDNC, isSecurity: false,
      signal: { ageHours, slaBreached },
      reason: slaBreached ? 'Untouched referral past SLA — first-touch invitation' : 'New referral — first-touch invitation',
      recipientName: rec.name,
    })
  }
  return out
}

/** Gather all candidates for one agent, on that agent's configured channel. */
async function candidatesFor(agentKey: OutreachAgentKey, channel: 'sms' | 'email'): Promise<OutreachCandidate[]> {
  switch (agentKey) {
    case 'cross_sell': return crossSellCandidates(channel)
    case 'term_conversion': return termConversionCandidates(channel)
    case 'referral_followup': return referralFollowupCandidates(channel)
    // win-back → member/consent mapping is a pending config (§2.3); no candidates yet.
    case 'marketing_automation': return []
    default: return []
  }
}

export interface BuildQueueResult {
  queued: number
  byAgent: Record<string, { queued: number; skipped: number }>
  note: string
}

/**
 * Build today's prioritized outreach queue for every enabled outreach agent, up to
 * each agent's daily quota. Idempotent: the unique (queue_date, agent, entity) keeps
 * re-runs from double-queuing. Returns per-agent counts.
 */
export async function buildQueue(): Promise<BuildQueueResult> {
  const db = getDb()
  const targets = await loadTargets()
  const byAgent: Record<string, { queued: number; skipped: number }> = {}
  let queued = 0

  for (const agentKey of OUTREACH_AGENTS) {
    const t = targets[agentKey]
    if (!t || !t.enabled || t.daily_target <= 0) { byAgent[agentKey] = { queued: 0, skipped: 0 }; continue }

    const candidates = await candidatesFor(agentKey, t.channel)
    const { selected, skipped } = selectForQuota(candidates, t.daily_target)
    byAgent[agentKey] = { queued: selected.length, skipped: skipped.length }

    for (const c of selected) {
      const { error } = await db.from('outreach_queue').insert({
        agent_key: agentKey,
        source: c.source,
        entity_type: c.entityType,
        entity_id: c.entityId,
        household_id: c.householdId,
        member_id: c.memberId,
        channel: c.channel,
        priority: priorityOf(c),
        reason: c.reason,
        is_security: c.isSecurity,
        status: 'queued',
      })
      // A duplicate-key error just means it was already queued today — that's the
      // idempotency guarantee, not a failure.
      if (!error) queued++
    }

    await writeAudit({
      actor: `agent:${agentKey}`,
      action: 'ai.action',
      entity: 'outreach_queue',
      diff: { phase: 'build', agentKey, queued: selected.length, skipped: skipped.length, greenzone: true },
    })
  }

  return {
    queued,
    byAgent,
    note: `workforce/build: ${queued} queued across ${OUTREACH_AGENTS.length} agents`,
  }
}

interface QueueItem {
  id: string
  agent_key: string
  source: string
  entity_type: string
  entity_id: string
  household_id: string | null
  member_id: string | null
  channel: 'sms' | 'email'
  reason: string | null
  is_security: boolean
}

/**
 * Run ONE outreach agent as a durable agent run: draft + gate-send each of today's
 * queued items, up to the agent's remaining quota. Wraps jobs/agent-runner.runAgent
 * so every send is attributed, kill-switch-gated, and escalates on block.
 */
export async function runOutreachAgent(agentKey: OutreachAgentKey): Promise<{ sent: number; blocked: number; escalated: number; skipped: number }> {
  const db = getDb()
  const targets = await loadTargets()
  const t = targets[agentKey]
  const stats = { sent: 0, blocked: 0, escalated: 0, skipped: 0 }
  if (!t || !t.enabled || t.daily_target <= 0) return stats

  // Remaining quota = today's target minus what already sent today.
  const today = new Date().toISOString().slice(0, 10)
  const { count: sentToday } = await db
    .from('outreach_queue')
    .select('id', { count: 'exact', head: true })
    .eq('queue_date', today).eq('agent_key', agentKey).eq('status', 'sent')
  const remaining = Math.max(0, t.daily_target - (sentToday ?? 0))
  if (remaining === 0) return stats

  const { data: items } = await db
    .from('outreach_queue')
    .select('id, agent_key, source, entity_type, entity_id, household_id, member_id, channel, reason, is_security')
    .eq('queue_date', today).eq('agent_key', agentKey).eq('status', 'queued')
    .order('priority', { ascending: false })
    .limit(remaining)

  const queue = (items ?? []) as QueueItem[]
  if (queue.length === 0) return stats

  await runAgent({
    agentKey,
    dedupeKey: `workforce:${agentKey}:${today}`,
    input: { phase: 'dispatch', count: queue.length },
    work: async (ctx) => {
      ctx.setConfidence(0.9)
      for (const item of queue) {
        // Atomically CLAIM the item (queued → drafted). Only one pass wins the claim,
        // so a runAgent retry (its work() is wrapped in retry) or a concurrent run can
        // never re-send an item already handled — the update is a no-op once status
        // has moved off 'queued'. This is the double-send guard.
        const { data: claimed } = await db
          .from('outreach_queue')
          .update({ status: 'drafted', run_id: ctx.runId, drafted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', item.id)
          .eq('status', 'queued')
          .select('id')
          .maybeSingle()
        if (!claimed) continue

        // Defense in depth: never draft/send a securities-flagged item (queue rows are
        // always is_security=false — securities are excluded at build — so this is a
        // guard, not a normal path).
        if (item.is_security) {
          await db.from('outreach_queue').update({ status: 'escalated', block_reason: 'securities_firewall', updated_at: new Date().toISOString() }).eq('id', item.id)
          await ctx.escalate('securities_firewall', { targetType: item.entity_type, targetId: item.entity_id })
          stats.escalated++
          continue
        }

        // Resolve the recipient contact fresh (the gate re-checks consent/DNC anyway).
        const rec = await resolveRecipient(item.household_id, item.channel, null)
        if (!rec.contact || !rec.memberId) {
          await db.from('outreach_queue').update({ status: 'skipped', block_reason: 'no_contact_method', updated_at: new Date().toISOString() }).eq('id', item.id)
          stats.skipped++
          continue
        }

        // Draft a green-zone message via the gateway (Claude-first, fallbacks).
        const knowledge = renderKnowledgeContext(
          await searchKnowledge(item.reason ?? item.source, { limit: 3, clientSafeOnly: true }),
        )
        const userContent = buildDraftUserContent(
          { source: item.source as OutreachCandidate['source'], channel: item.channel, reason: item.reason ?? item.source, recipientName: rec.name },
          knowledge,
        )
        const res = await ctx.gateway({
          system: OUTREACH_PROMPTS[agentKey],
          maxTokens: 400,
          messages: [{ role: 'user', content: userContent }],
        })
        let draft = res.text.trim()

        // Belt-and-suspenders: reject recommendation language BEFORE the send (the
        // gate would block it too, but this avoids a wasted, escalation-only send).
        if (!draft || containsRecommendationLanguage(draft)) {
          await db.from('outreach_queue').update({ status: 'escalated', run_id: ctx.runId, block_reason: 'recommendation_language', drafted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', item.id)
          await ctx.escalate('recommendation_language', { targetType: item.entity_type, targetId: item.entity_id, draftedContent: draft })
          stats.escalated++
          continue
        }

        // Email carries the required educational disclaimer; SMS stays short (footer
        // appended by the dispatcher). The gate is still the final authority.
        const body = item.channel === 'email' ? `${draft}\n\n${FINRA_DISCLAIMER}` : draft

        const outcome = await sendThroughGate({
          channel: item.channel,
          to: rec.contact,
          subject: item.channel === 'email' ? 'A quick note from Markist' : undefined,
          body,
          actor: `agent:${agentKey}`,
          memberId: item.member_id,
          householdId: item.household_id,
          entity: { type: 'outreach_queue', id: item.id },
          isSecurity: false,
          aiGenerated: true,
          aiAuthorAgentKey: agentKey,
          recipientContext: { full_name: rec.name },
        })

        if (outcome.sent) {
          await db.from('outreach_queue').update({ status: 'sent', message_id: outcome.messageId ?? null, dispatched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', item.id)
          await ctx.recordAction({ kind: `outreach:${item.source}`, targetType: item.entity_type, targetId: item.entity_id, outcome: 'sent', note: item.reason ?? undefined })
          stats.sent++
        } else {
          // Blocked at the gate — the dispatcher already logged the compliance_event
          // + escalation. Mark the queue item and count it (never silently dropped).
          await db.from('outreach_queue').update({ status: 'blocked', message_id: outcome.messageId ?? null, block_reason: outcome.gate.blockedStep ?? 'blocked', updated_at: new Date().toISOString() }).eq('id', item.id)
          stats.blocked++
        }
      }
    },
  })

  return stats
}

export interface RunWorkforceResult {
  built: BuildQueueResult
  dispatch: Record<string, { sent: number; blocked: number; escalated: number; skipped: number }>
  totalSent: number
}

/** Full daily run: build the queue, then dispatch every enabled outreach agent. */
export async function runWorkforce(): Promise<RunWorkforceResult> {
  const built = await buildQueue()
  const dispatch: RunWorkforceResult['dispatch'] = {}
  let totalSent = 0
  for (const agentKey of OUTREACH_AGENTS) {
    const s = await runOutreachAgent(agentKey)
    dispatch[agentKey] = s
    totalSent += s.sent
  }
  return { built, dispatch, totalSent }
}
