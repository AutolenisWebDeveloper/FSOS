// Life Win-Back command-center data. Server-only, all DB-derived. There is no
// win-back VIEW — the re-engagement book lives in `contacts` (source='winback_life'),
// households whose agency once carried a Life line that has lapsed. Green-zone
// identify/invite only; consent + DNC flags on each contact are honored (guardrail
// §2.2 / §7). Premium-at-risk is an assumption-based estimate (§2.3). This surface
// reports what is REAL in the CRM — contactability, book segmentation, agency
// coverage — and never fabricates recovery figures that aren't tracked yet.

import { load } from '@/lib/data/query'
import { estPremium } from './assumptions'

export interface WinbackContact {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  tags: string[] | null
  lines_of_business: string[] | null
  agency_partnership_id: string | null
  household_id: string | null
  state: string | null
  status: string | null
  created_at: string
}

export interface WinbackDashboard {
  contacts: WinbackContact[]
  agencyName: Map<string, string>
  kpis: {
    total: number
    reachable: number
    suppressed: number
    linkedAgencies: number
    priority: number // tagged life-winback
    newLast30: number
    active: number
    worked: number
    estPremiumAtRisk: number
  }
  funnel: { label: string; value: number }[]
  lineDistribution: { label: string; value: number }[]
  contactability: { label: string; value: number }[]
  recency: { label: string; value: number }[]
  geography: { label: string; value: number }[]
  agencyLeaderboard: { name: string; value: number }[]
}

const has = (tags: string[] | null | undefined, t: string) =>
  !!tags && tags.some((x) => x.toLowerCase() === t)

export async function loadWinbackDashboard(): Promise<
  { ok: true; data: WinbackDashboard } | { ok: false; kind: 'not_configured' | 'error'; message: string }
> {
  const [contactsR, agenciesR] = await Promise.all([
    load<WinbackContact[]>(
      (db) =>
        db
          .from('contacts')
          .select('id, full_name, first_name, last_name, email, phone, tags, lines_of_business, agency_partnership_id, household_id, state, status, created_at')
          .eq('source', 'winback_life')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(5000),
      [],
    ),
    load<{ id: string; agency_name: string | null }[]>(
      (db) => db.from('agency_partnerships').select('id, agency_name').is('deleted_at', null).limit(2000),
      [],
    ),
  ])

  if (!contactsR.ok) return { ok: false, kind: contactsR.kind, message: contactsR.message }

  const contacts = contactsR.data
  const agencies = agenciesR.ok ? agenciesR.data : []
  const agencyName = new Map<string, string>()
  for (const a of agencies) if (a.id && a.agency_name) agencyName.set(a.id, a.agency_name)

  const now = Date.now()
  const DAY = 86400000

  // Contactability, honoring suppression flags (DNC / unsubscribe).
  const isDnc = (c: WinbackContact) => has(c.tags, 'dnc')
  const isUnsub = (c: WinbackContact) => has(c.tags, 'email-unsubscribed')
  const emailOk = (c: WinbackContact) => !!c.email && !isUnsub(c) && !isDnc(c)
  const phoneOk = (c: WinbackContact) => !!c.phone && !isDnc(c)
  const reachable = (c: WinbackContact) => emailOk(c) || phoneOk(c)

  const total = contacts.length
  const reachableCount = contacts.filter(reachable).length
  const suppressed = contacts.filter((c) => isDnc(c) || isUnsub(c)).length
  const priority = contacts.filter((c) => has(c.tags, 'life-winback')).length
  const newLast30 = contacts.filter((c) => now - new Date(c.created_at).getTime() < 30 * DAY).length
  const active = contacts.filter((c) => (c.status ?? 'active') === 'active').length
  const worked = contacts.filter((c) => c.status === 'archived').length
  const linkedAgencyIds = new Set(contacts.map((c) => c.agency_partnership_id).filter(Boolean) as string[])

  // Prior lines of business held (context, not a recommendation).
  const lineCounts = new Map<string, number>()
  for (const c of contacts) {
    for (const line of c.lines_of_business ?? []) {
      const key = line.toLowerCase()
      lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1)
    }
  }
  const lineDistribution = [...lineCounts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)

  // Contactability mix.
  let both = 0, phoneOnly = 0, emailOnly = 0, none = 0
  for (const c of contacts) {
    const e = emailOk(c), p = phoneOk(c)
    if (e && p) both++
    else if (p) phoneOnly++
    else if (e) emailOnly++
    else none++
  }
  const contactability = [
    { label: 'Phone + email', value: both },
    { label: 'Phone only', value: phoneOnly },
    { label: 'Email only', value: emailOnly },
    { label: 'Suppressed / none', value: none },
  ]

  // Time since added (proxy for time-since-lapse recency).
  const bands = { '≤ 30 days': 0, '31–90 days': 0, '91–180 days': 0, '181–365 days': 0, '> 1 year': 0 }
  for (const c of contacts) {
    const d = (now - new Date(c.created_at).getTime()) / DAY
    if (d <= 30) bands['≤ 30 days']++
    else if (d <= 90) bands['31–90 days']++
    else if (d <= 180) bands['91–180 days']++
    else if (d <= 365) bands['181–365 days']++
    else bands['> 1 year']++
  }
  const recency = Object.entries(bands).map(([label, value]) => ({ label, value }))

  // Geography (top states).
  const stateCounts = new Map<string, number>()
  for (const c of contacts) {
    const s = (c.state ?? '').trim().toUpperCase() || 'Unknown'
    stateCounts.set(s, (stateCounts.get(s) ?? 0) + 1)
  }
  const geography = [...stateCounts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6)

  // Agency leaderboard (books with the most lapsed life clients to win back).
  const agencyCounts = new Map<string, number>()
  for (const c of contacts) {
    if (!c.agency_partnership_id) continue
    agencyCounts.set(c.agency_partnership_id, (agencyCounts.get(c.agency_partnership_id) ?? 0) + 1)
  }
  const agencyLeaderboard = [...agencyCounts.entries()]
    .map(([id, value]) => ({ name: agencyName.get(id) ?? 'Unlinked agency', value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  const funnel = [
    { label: 'Lapsed life clients', value: total },
    { label: 'Contactable', value: reachableCount },
    { label: 'In active queue', value: contacts.filter((c) => (c.status ?? 'active') === 'active' && reachable(c)).length },
    { label: 'Worked / closed', value: worked },
  ]

  return {
    ok: true,
    data: {
      contacts,
      agencyName,
      kpis: {
        total,
        reachable: reachableCount,
        suppressed,
        linkedAgencies: linkedAgencyIds.size,
        priority,
        newLast30,
        active,
        worked,
        estPremiumAtRisk: estPremium(total),
      },
      funnel,
      lineDistribution,
      contactability,
      recency,
      geography,
      agencyLeaderboard,
    },
  }
}
