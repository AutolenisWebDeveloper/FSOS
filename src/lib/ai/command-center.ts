// src/lib/ai/command-center.ts
// The PURE view-model for the AI Command Center (the operational cockpit at
// /app/ai/workforce, §20 of the AI Revenue Command Center initiative). Deliberately
// DB-free (imports nothing) so it compiles/tests in isolation and the executive-status,
// roster-health, results, and human-attention composition is unit-provable independent
// of Supabase — the same discipline as lib/ai/outreach.ts.
//
// This is a COMPOSITION layer over data the workforce already produces
// (v_workforce_today, outreach_queue, agent_actions escalations, compliance_events).
// It is NOT a second orchestration engine and holds NO source of truth: it reads the
// rows the existing runner writes and rolls them up for the operator.
//
// GUARDRAILS surfaced here (not just documented):
//   • Securities firewall — a securities-flagged queue item is surfaced as a
//     `firewall` attention item at the highest severity and is NEVER counted toward
//     sent/engaged results. Automation can only route it to human/FFS handling.
//   • Human-in-the-loop — every block, escalation, and held item becomes a typed,
//     ranked "needs your attention" entry so nothing automated fails silently.

/** One row of v_workforce_today (per outreach agent, today). */
export interface WorkforceRow {
  agent_key: string
  agent_enabled: boolean
  daily_target: number
  channel: string
  target_enabled: boolean
  is_assumption: boolean
  queued_total: number
  sent: number
  blocked: number
  escalated: number
  skipped: number
  pending: number
  drafted: number
  engaged: number
  remaining: number
}

/** One row of today's outreach_queue (subset the Command Center reads). */
export interface QueueRow {
  id: string
  agent_key: string
  source: string
  channel: string
  priority: number
  reason: string | null
  status: string
  block_reason: string | null
  outcome: string | null
  is_security: boolean
  entity_type: string | null
  household_id: string | null
}

/** One agent_actions row of kind='escalation' (the human-handoff surface). */
export interface EscalationRow {
  id: string
  reason: string | null
  target_type: string | null
  target_id: string | null
  note: string | null
  blocked_step: string | null
  created_at: string
}

/** One compliance_events row (firewall / comms-blocked context). */
export interface ComplianceEventRow {
  id: string
  kind: string
  reason: string | null
  blocked_step: string | null
  channel: string | null
  created_at: string
}

// ─── Executive status ─────────────────────────────────────────────────────────

export interface ExecutiveStatus {
  /** Agents enabled AND with an enabled daily target — actively working. */
  activeWorkers: number
  /** Agents whose target is paused (target_enabled = false) but agent is on. */
  pausedWorkers: number
  /** Agents whose kill switch is off (agent_enabled = false). */
  offWorkers: number
  queuedTotal: number
  /** Queued + drafted — work in flight. */
  inProgress: number
  /** Held items awaiting a human decision (approval-required surface). */
  approvalRequired: number
  escalations: number
  /** Sent today (completed client contact). */
  completedToday: number
  /** Blocked today (a send the gate refused). */
  failedToday: number
}

/**
 * Roll the per-agent workforce rows into the executive header counts. Only agents
 * that carry a quota or have queued work are considered "workers" (mirrors the
 * page's own filter) so idle/unconfigured roster keys don't inflate the counts.
 */
export function executiveStatus(workforce: WorkforceRow[]): ExecutiveStatus {
  const workers = workforce.filter((r) => r.daily_target > 0 || r.queued_total > 0)
  let active = 0
  let paused = 0
  let off = 0
  for (const r of workers) {
    if (!r.agent_enabled) off += 1
    else if (!r.target_enabled) paused += 1
    else active += 1
  }
  const sum = (pick: (r: WorkforceRow) => number) => workers.reduce((s, r) => s + pick(r), 0)
  return {
    activeWorkers: active,
    pausedWorkers: paused,
    offWorkers: off,
    queuedTotal: sum((r) => r.queued_total),
    inProgress: sum((r) => r.pending + r.drafted),
    approvalRequired: 0, // filled by the caller from held queue items (see heldCount)
    escalations: sum((r) => r.escalated),
    completedToday: sum((r) => r.sent),
    failedToday: sum((r) => r.blocked),
  }
}

// ─── Results roll-up ──────────────────────────────────────────────────────────

export interface ResultsToday {
  sent: number
  engaged: number
  blocked: number
  escalated: number
}

/**
 * Operational results for the day. `engaged` is a workforce fact (a reply/booking/
 * conversion recorded on the queue), never an estimate — the Command Center reports
 * activity, not revenue (revenue lives in the Revenue Center with its own actual/
 * weighted/projected distinction).
 */
export function resultsToday(workforce: WorkforceRow[]): ResultsToday {
  const sum = (pick: (r: WorkforceRow) => number) => workforce.reduce((s, r) => s + pick(r), 0)
  return {
    sent: sum((r) => r.sent),
    engaged: sum((r) => r.engaged),
    blocked: sum((r) => r.blocked),
    escalated: sum((r) => r.escalated),
  }
}

// ─── Roster health ────────────────────────────────────────────────────────────

export type WorkerStatus = 'working' | 'paused' | 'agent_off'
export type WorkerHealth = 'healthy' | 'degraded' | 'idle'

export interface RosterEntry {
  agentKey: string
  channel: string
  isAssumption: boolean
  dailyTarget: number
  sent: number
  inProgress: number
  blockedEscalated: number
  engaged: number
  remaining: number
  status: WorkerStatus
  health: WorkerHealth
  /** Blocked+escalated as a share of everything queued today (0..1). */
  errorRate: number
}

/** Threshold above which a worker is flagged `degraded` (color-independent label). */
export const DEGRADED_ERROR_RATE = 0.25

function statusOf(r: WorkforceRow): WorkerStatus {
  if (!r.agent_enabled) return 'agent_off'
  if (!r.target_enabled) return 'paused'
  return 'working'
}

function healthOf(r: WorkforceRow, errorRate: number, status: WorkerStatus): WorkerHealth {
  if (status !== 'working') return 'idle'
  if (r.queued_total === 0) return 'idle'
  return errorRate > DEGRADED_ERROR_RATE ? 'degraded' : 'healthy'
}

/**
 * Per-agent operating view: status (from the two kill switches), a health signal
 * derived from the block/escalation rate, and the day's counters. Only agents with
 * a quota or queued work are returned, sorted by remaining work then agent key.
 */
export function rosterHealth(workforce: WorkforceRow[]): RosterEntry[] {
  return workforce
    .filter((r) => r.daily_target > 0 || r.queued_total > 0)
    .map((r) => {
      const status = statusOf(r)
      const denom = r.queued_total > 0 ? r.queued_total : r.sent + r.blocked + r.escalated
      const errorRate = denom > 0 ? (r.blocked + r.escalated) / denom : 0
      return {
        agentKey: r.agent_key,
        channel: r.channel,
        isAssumption: r.is_assumption,
        dailyTarget: r.daily_target,
        sent: r.sent,
        inProgress: r.pending + r.drafted,
        blockedEscalated: r.blocked + r.escalated,
        engaged: r.engaged,
        remaining: r.remaining,
        status,
        health: healthOf(r, errorRate, status),
        errorRate,
      }
    })
    .sort((a, b) => b.remaining - a.remaining || a.agentKey.localeCompare(b.agentKey))
}

// ─── Human attention ──────────────────────────────────────────────────────────

export type AttentionCategory =
  | 'firewall' // securities-flagged — route to FFS, never automate
  | 'compliance_block' // a compliance_event blocked a send
  | 'escalation' // an agent handed off to the human FSA
  | 'blocked_send' // a queue item the gate refused
  | 'held' // a queue item a human paused for review/approval

export type AttentionSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface AttentionItem {
  key: string
  category: AttentionCategory
  severity: AttentionSeverity
  title: string
  detail: string
  /** True for securities-firewall items — the UI renders the purple marker. */
  isSecurity: boolean
  createdAt?: string
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const CATEGORY_SEVERITY: Record<AttentionCategory, AttentionSeverity> = {
  firewall: 'critical',
  compliance_block: 'critical',
  escalation: 'high',
  blocked_send: 'medium',
  held: 'low',
}

/**
 * Unify every "needs a human" signal into one ranked list. Securities-firewall queue
 * items are surfaced explicitly (critical) and flagged `isSecurity` so the operator
 * sees the firewall working — they are handled here as attention, NEVER as outreach.
 * Sorted by severity, then newest first.
 */
export function attentionItems(
  queue: QueueRow[],
  escalations: EscalationRow[],
  complianceEvents: ComplianceEventRow[],
): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const q of queue) {
    if (q.is_security) {
      items.push({
        key: `fw:${q.id}`,
        category: 'firewall',
        severity: CATEGORY_SEVERITY.firewall,
        title: 'Securities-flagged record — route to FFS',
        detail: q.reason ?? 'Excluded from automated outreach by the securities firewall.',
        isSecurity: true,
      })
    } else if (q.status === 'blocked') {
      items.push({
        key: `bl:${q.id}`,
        category: 'blocked_send',
        severity: CATEGORY_SEVERITY.blocked_send,
        title: 'Outreach blocked by the compliance gate',
        detail: q.block_reason ?? q.reason ?? 'A send was refused before dispatch.',
        isSecurity: false,
      })
    } else if (q.status === 'held') {
      items.push({
        key: `hl:${q.id}`,
        category: 'held',
        severity: CATEGORY_SEVERITY.held,
        title: 'Held for your review',
        detail: q.reason ?? 'A queue item paused pending a human decision.',
        isSecurity: false,
      })
    }
  }

  for (const e of escalations) {
    items.push({
      key: `es:${e.id}`,
      category: 'escalation',
      severity: CATEGORY_SEVERITY.escalation,
      title: 'Escalated to you',
      detail: e.reason ?? e.note ?? 'An agent handed this off for human handling.',
      isSecurity: false,
      createdAt: e.created_at,
    })
  }

  for (const c of complianceEvents) {
    const isFirewall = c.blocked_step === 'is_security' || c.kind === 'firewall'
    items.push({
      key: `ce:${c.id}`,
      category: isFirewall ? 'firewall' : 'compliance_block',
      severity: isFirewall ? CATEGORY_SEVERITY.firewall : CATEGORY_SEVERITY.compliance_block,
      title: isFirewall ? 'Securities firewall block' : 'Compliance block logged',
      detail: c.reason ?? `Blocked at step: ${c.blocked_step ?? 'unknown'}.`,
      isSecurity: isFirewall,
      createdAt: c.created_at,
    })
  }

  return items.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (s !== 0) return s
    if (a.createdAt && b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    return 0
  })
}

/** Count of held (human-approval-required) queue items. */
export function heldCount(queue: QueueRow[]): number {
  return queue.reduce((n, q) => n + (q.status === 'held' ? 1 : 0), 0)
}
