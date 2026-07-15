// src/lib/data/shell.ts
// Server-side loaders for the branded shell's character panels
// (docs/design-system.md §5.3): AI live status, current GDC tier, FFS contacts.
// Every query goes through load() so an unconfigured/erroring backend degrades to
// a labeled fallback instead of blanking the shell.
import { load } from '@/lib/data/query'
import { AGENT_ROSTER } from '@/lib/ai/roster'
import { getTier, FFS_CONTACTS } from '@/lib/compliance'
import { loadFfsContacts } from '@/lib/data/ffs'

export type AgentState = 'running' | 'idle' | 'escalated'

// Structural shapes for the tier card + contacts panel. Both the hardcoded
// lib/compliance defaults AND the editable DB config (gdc_tiers / ffs_contacts,
// migration 016) map into these, so the panels render identically from either
// source. Config is the source of record (guardrail 3 — config-driven, not
// hardcoded); the constants are only the labeled fallback when the tables are
// empty or the backend isn't wired.
export interface GdcTierView {
  tier: number
  label: string
  minGdc: number
  maxGdc: number
  rate: number
  rateLabel: string
  range: string
}

export interface FfsContactView {
  role: string
  name: string
  tel: string
  ext?: string
  hours?: string
  email?: string
}

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
  tier: GdcTierView
  rollingGdc: number
  contacts: FfsContactView[]
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

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** Human range label for a half-open [min, max) band, matching the constant style. */
function rangeText(minGdc: number, maxGdc: number): string {
  if (!Number.isFinite(maxGdc)) return `${money(minGdc)}+`
  if (minGdc <= 0) return `Under ${money(maxGdc)}`
  return `${money(minGdc)} – ${money(maxGdc - 1)}`
}

/** Current tier for a rolling GDC over ascending half-open bands (mirrors getTier). */
function pickTier(tiers: GdcTierView[], rollingGdc: number): GdcTierView {
  const g = Number.isFinite(rollingGdc) ? Math.max(0, rollingGdc) : 0
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (g >= tiers[i].minGdc) return tiers[i]
  }
  return tiers[0]
}

/** Editable GDC tier config (migration 016), or null when unconfigured/empty. */
async function loadConfiguredTiers(): Promise<GdcTierView[] | null> {
  const res = await load<
    { tier_no: number; label: string; min_gdc: number; max_gdc: number | null; payout_pct: number }[]
  >(
    (db) =>
      db
        .from('gdc_tiers')
        .select('tier_no, label, min_gdc, max_gdc, payout_pct')
        .eq('active', true)
        .order('min_gdc', { ascending: true }),
    [],
  )
  if (!res.ok || res.data.length === 0) return null
  return res.data.map((t) => {
    const minGdc = Number(t.min_gdc ?? 0)
    const maxGdc = t.max_gdc === null || t.max_gdc === undefined ? Infinity : Number(t.max_gdc)
    const pct = Number(t.payout_pct ?? 0)
    return {
      tier: t.tier_no,
      label: t.label,
      minGdc,
      maxGdc,
      rate: pct / 100,
      rateLabel: `${pct}%`,
      range: rangeText(minGdc, maxGdc),
    }
  })
}

/** Editable FFS contact directory (migration 016), or null when unconfigured/empty. */
async function loadConfiguredContacts(): Promise<FfsContactView[] | null> {
  const res = await loadFfsContacts(true)
  if (!res.ok || res.contacts.length === 0) return null
  return res.contacts.map((c) => ({
    role: c.role,
    name: c.name ?? '',
    tel: c.phone,
    ext: c.note ?? undefined,
    hours: c.hours ?? undefined,
  }))
}

/** Load everything the branded FSA sidebar needs, resilient to an unwired backend. */
export async function loadShellData(): Promise<ShellData> {
  const [
    { agents, escalations, assumed: aAssumed },
    { value: rollingGdc, assumed: gAssumed },
    cfgTiers,
    cfgContacts,
  ] = await Promise.all([loadAgentStatus(), loadRollingGdc(), loadConfiguredTiers(), loadConfiguredContacts()])

  // Prefer editable config (source of record); fall back to the labeled defaults.
  const tier: GdcTierView = cfgTiers ? pickTier(cfgTiers, rollingGdc) : getTier(rollingGdc)
  const contacts: FfsContactView[] =
    cfgContacts ??
    FFS_CONTACTS.map((c) => ({
      role: c.role,
      name: c.name,
      tel: c.tel,
      ext: 'ext' in c ? c.ext : undefined,
      hours: 'hours' in c ? c.hours : undefined,
      email: 'email' in c ? c.email : undefined,
    }))

  return {
    agents,
    escalations,
    tier,
    rollingGdc,
    contacts,
    // GDC tiers + FFS contacts are always config defaults (guardrail 3), so the
    // panels always carry the assumption badge regardless of backend wiring.
    assumed: aAssumed || gAssumed,
  }
}
