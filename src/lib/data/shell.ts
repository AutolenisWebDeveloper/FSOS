// src/lib/data/shell.ts
// Server-side loaders for the branded shell's character panels
// (docs/design-system.md §5.3): AI live status, current GDC tier, FFS contacts.
// Every query goes through load() so an unconfigured/erroring backend degrades to
// a labeled fallback instead of blanking the shell.
import { load } from '@/lib/data/query'
import { AGENT_ROSTER } from '@/lib/ai/roster'
import { GDC_TIERS, getTier, FFS_CONTACTS } from '@/lib/compliance'

export type AgentState = 'running' | 'idle' | 'escalated'

export interface AgentStatusRow {
  key: string
  name: string
  enabled: boolean
  isGuardrail: boolean
  /** Active/recent runs in the trailing window. */
  active: number
  state: AgentState
}

export interface ShellData {
  agents: AgentStatusRow[]
  escalations: number
  tier: (typeof GDC_TIERS)[number]
  rollingGdc: number
  contacts: typeof FFS_CONTACTS
  /** True when the panels are running on labeled defaults (backend not wired). */
  assumed: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

// The compact roster the LIVE STATUS panel surfaces (design-system.md §5.3A).
// Guardrail is always last and always shown (it cannot be disabled).
const PANEL_KEYS = ['referral_triage', 'term_conversion', 'cross_sell', 'compliance_guardrail']

function titleize(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Sum of non-security gross commission (GDC proxy) over the trailing 12 months. */
async function loadRollingGdc(): Promise<{ value: number; assumed: boolean }> {
  const since = new Date(Date.now() - 365 * DAY_MS).toISOString()
  const res = await load<{ total_commission: number | null }[]>(
    (db) =>
      db
        .from('commissions')
        .select('total_commission')
        .eq('is_security', false)
        .gte('created_at', since),
    [],
  )
  if (!res.ok) return { value: 0, assumed: true }
  const value = res.data.reduce((sum, r) => sum + Number(r.total_commission ?? 0), 0)
  return { value, assumed: false }
}

async function loadAgentStatus(): Promise<{
  agents: AgentStatusRow[]
  escalations: number
  assumed: boolean
}> {
  const since = new Date(Date.now() - DAY_MS).toISOString()
  const [agentsRes, runsRes, escRes] = await Promise.all([
    load<{ key: string; name: string; enabled: boolean; is_guardrail: boolean }[]>(
      (db) => db.from('ai_agents').select('key, name, enabled, is_guardrail'),
      [],
    ),
    load<{ agent_key: string; status: string }[]>(
      (db) => db.from('agent_runs').select('agent_key, status').gte('started_at', since),
      [],
    ),
    load<{ id: string }[]>(
      (db) =>
        db
          .from('agent_actions')
          .select('id')
          .eq('kind', 'escalation')
          .or('outcome.eq.escalated,outcome.is.null'),
      [],
    ),
  ])

  const assumed = !agentsRes.ok
  const dbAgents = agentsRes.ok ? agentsRes.data : []
  const byKey = new Map(dbAgents.map((a) => [a.key, a]))

  // Active-run counts per agent over the trailing window.
  const active = new Map<string, number>()
  const running = new Set<string>()
  if (runsRes.ok) {
    for (const r of runsRes.data) {
      active.set(r.agent_key, (active.get(r.agent_key) ?? 0) + 1)
      if (r.status === 'running') running.add(r.agent_key)
    }
  }
  const escalations = escRes.ok ? escRes.data.length : 0

  const agents: AgentStatusRow[] = PANEL_KEYS.map((key) => {
    const meta = byKey.get(key)
    const def = AGENT_ROSTER[key]
    const isGuardrail = meta?.is_guardrail ?? key === 'compliance_guardrail'
    const count = active.get(key) ?? 0
    let state: AgentState = 'idle'
    if (!isGuardrail && escalations > 0 && (key === 'referral_triage' || running.has(key))) {
      state = running.has(key) ? 'running' : 'escalated'
    } else if (running.has(key) || count > 0) {
      state = 'running'
    }
    return {
      key,
      name: meta?.name ?? (def ? titleize(key) : titleize(key)),
      enabled: meta?.enabled ?? true,
      isGuardrail,
      active: count,
      state,
    }
  })

  return { agents, escalations, assumed }
}

/** Load everything the branded FSA sidebar needs, resilient to an unwired backend. */
export async function loadShellData(): Promise<ShellData> {
  const [{ agents, escalations, assumed: aAssumed }, { value: rollingGdc, assumed: gAssumed }] =
    await Promise.all([loadAgentStatus(), loadRollingGdc()])
  return {
    agents,
    escalations,
    tier: getTier(rollingGdc),
    rollingGdc,
    contacts: FFS_CONTACTS,
    // GDC tiers + FFS contacts are always config defaults (guardrail 3), so the
    // panels always carry the assumption badge regardless of backend wiring.
    assumed: aAssumed || gAssumed,
  }
}
