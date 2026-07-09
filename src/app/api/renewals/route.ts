import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/renewals?window=90  (internal)
// Upcoming, time-sensitive client events within the window, sorted by date:
//   • term_conversion  — a term policy's conversion deadline is approaching
//   • policy_renewal   — a policy expiry / renewal date is approaching
//   • policy_anniversary — the next anniversary of a policy's issue date
//   • birthday         — the client's next birthday
// Computed in JS (recurring-date math) over a bounded slice of the book.
const MAX_SCAN = 2000

interface RenewalEvent {
  type: 'term_conversion' | 'policy_renewal' | 'policy_anniversary' | 'birthday'
  date: string // YYYY-MM-DD
  days_until: number
  customer_id: string | null
  customer_name: string
  phone: string | null
  email: string | null
  label: string
  detail: string | null
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + 'T00:00:00Z')
  const b = Date.parse(toISO + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}
// Next occurrence (today or later) of a recurring month/day, from a source date string.
function nextAnniversary(sourceDate: string, todayISO: string): string | null {
  const src = new Date(sourceDate + 'T00:00:00Z')
  if (Number.isNaN(src.getTime())) return null
  const today = new Date(todayISO + 'T00:00:00Z')
  let year = today.getUTCFullYear()
  const mk = (y: number) => {
    const d = new Date(Date.UTC(y, src.getUTCMonth(), src.getUTCDate()))
    // Handle Feb 29 rolling to Mar 1 in non-leap years.
    if (d.getUTCMonth() !== src.getUTCMonth()) d.setUTCDate(0)
    return d
  }
  let cand = mk(year)
  if (iso(cand) < todayISO) cand = mk(++year)
  return iso(cand)
}

export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const windowDays = Math.min(Math.max(Number.parseInt(url.searchParams.get('window') || '90', 10) || 90, 1), 365)
  const today = iso(new Date())
  const horizon = iso(new Date(Date.now() + windowDays * 86_400_000))

  const supabase = getDb()
  const [policiesRes, customersRes] = await Promise.all([
    supabase
      .from('policies')
      .select('policy_id, policy_type, carrier, conversion_deadline, expiry_date, issue_date, status, customer_id, customers(first_name, last_name, phone, email)')
      .eq('status', 'active')
      .limit(MAX_SCAN),
    supabase
      .from('customers')
      .select('customer_id, first_name, last_name, dob, phone, email')
      .not('dob', 'is', null)
      .limit(MAX_SCAN),
  ])

  const events: RenewalEvent[] = []
  const within = (d: string | null | undefined): d is string => !!d && d >= today && d <= horizon

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cname = (c: any) => (c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : 'Client')

  for (const p of policiesRes.data || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (p as any).customers
    const base = {
      customer_id: p.customer_id,
      customer_name: cname(c),
      phone: c?.phone || null,
      email: c?.email || null,
    }
    if (within(p.conversion_deadline)) {
      events.push({
        ...base,
        type: 'term_conversion',
        date: p.conversion_deadline,
        days_until: daysBetween(today, p.conversion_deadline),
        label: 'Term conversion deadline',
        detail: `${p.policy_type || 'term'} · ${p.carrier || ''}`.trim(),
      })
    }
    if (within(p.expiry_date)) {
      events.push({
        ...base,
        type: 'policy_renewal',
        date: p.expiry_date,
        days_until: daysBetween(today, p.expiry_date),
        label: 'Policy renewal / expiry',
        detail: `${p.policy_type || 'policy'} · ${p.carrier || ''}`.trim(),
      })
    }
    const anniv = p.issue_date ? nextAnniversary(p.issue_date, today) : null
    if (within(anniv)) {
      events.push({
        ...base,
        type: 'policy_anniversary',
        date: anniv,
        days_until: daysBetween(today, anniv),
        label: 'Policy anniversary',
        detail: `${p.policy_type || 'policy'} · ${p.carrier || ''}`.trim(),
      })
    }
  }

  for (const c of customersRes.data || []) {
    const bday = c.dob ? nextAnniversary(c.dob, today) : null
    if (within(bday)) {
      events.push({
        type: 'birthday',
        date: bday,
        days_until: daysBetween(today, bday),
        customer_id: c.customer_id,
        customer_name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        phone: c.phone || null,
        email: c.email || null,
        label: 'Birthday',
        detail: null,
      })
    }
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1
    return acc
  }, {})

  return NextResponse.json({ window_days: windowDays, total: events.length, counts, events })
}
