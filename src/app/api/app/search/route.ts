import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/app/search?q=<term>&limit=8 — RLS-scoped global search for the FSA
// portal (ports the legacy top-bar search onto the aggregate-root spine).
//
// Firewall (guardrail 1): this route is gated to the FSA portal
// (fsa/licensed_staff/super_admin) via requireApiRole — a client or partner
// session receives 403 and never reaches this query. It searches only
// non-securities entities (households, members, agencies, referrals); it never
// returns a household_policies/opportunities row, so no is_security substantive
// record can leak through search. Reads run with the service role AFTER the
// portal gate; per-book scoping is enforced by RLS on the underlying tables.

type SearchHit = {
  type: 'household' | 'member' | 'agency' | 'referral'
  id: string
  title: string
  subtitle: string | null
  href: string
}

function sanitize(q: string): { like: string; digits: string } | null {
  const safe = q
    .replace(/[,()*]/g, ' ')
    .trim()
    .replace(/[%_\\]/g, (m) => `\\${m}`)
  if (!safe) return null
  return { like: `%${safe}%`, digits: q.replace(/\D/g, '') }
}

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  const limitRaw = Number.parseInt(req.nextUrl.searchParams.get('limit') || '8', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 20) : 8
  if (q.length < 2) return NextResponse.json({ results: [] })

  const s = sanitize(q)
  if (!s) return NextResponse.json({ results: [] })
  const db = getDb()

  const memberFilter = [`full_name.ilike.${s.like}`, `email.ilike.${s.like}`]
  if (s.digits.length >= 3) memberFilter.push(`phone.ilike.%${s.digits}%`)

  try {
    const [households, members, agencies, referrals] = await Promise.all([
      db.from('households').select('id, primary_name, city, state').ilike('primary_name', s.like).limit(limit),
      db.from('household_members').select('id, household_id, full_name, relationship').or(memberFilter.join(',')).limit(limit),
      db
        .from('agency_partnerships')
        .select('id, agency_name, owner_name')
        .or(`agency_name.ilike.${s.like},owner_name.ilike.${s.like}`)
        .is('deleted_at', null)
        .limit(limit),
      db.from('referrals').select('id, referred_name, status').ilike('referred_name', s.like).limit(limit),
    ])

    const results: SearchHit[] = []
    for (const h of households.data ?? []) {
      results.push({
        type: 'household',
        id: h.id,
        title: h.primary_name,
        subtitle: [h.city, h.state].filter(Boolean).join(', ') || null,
        href: `/app/households/${h.id}`,
      })
    }
    for (const m of members.data ?? []) {
      results.push({
        type: 'member',
        id: m.id,
        title: m.full_name,
        subtitle: m.relationship || 'Household member',
        href: `/app/households/${m.household_id}`,
      })
    }
    for (const a of agencies.data ?? []) {
      results.push({
        type: 'agency',
        id: a.id,
        title: a.agency_name,
        subtitle: a.owner_name || null,
        href: `/app/agencies/${a.id}`,
      })
    }
    for (const r of referrals.data ?? []) {
      results.push({
        type: 'referral',
        id: r.id,
        title: r.referred_name || 'Referral',
        subtitle: r.status,
        href: `/app/referrals/${r.id}`,
      })
    }

    return NextResponse.json({ results: results.slice(0, limit * 2) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Search failed' }, { status: 500 })
  }
}
