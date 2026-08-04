import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole } from '@/lib/auth/api'
import { sanitize } from '@/lib/search/sanitize'

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
// record can leak through search.
//
// Authorization scope (corrected — was previously mis-stated as "RLS-enforced"):
// reads run with the SERVICE-ROLE client (getDb), which BYPASSES RLS by design,
// so RLS does NOT scope these results. What authorizes them is the
// requireApiRole('fsa') gate above: the FSA book is single-tenant and all three
// FSA roles are entitled to the whole book, so returning any book row to an
// authenticated FSA session is correct. This route is therefore FSA-ONLY and MUST
// NOT be reused for a tenant-scoped portal (partner/client) without adding an
// explicit owner/scope filter to every query — the portal gate alone would leak
// cross-tenant there. Soft-deleted rows are excluded (deleted_at is null) so
// removed records never surface in search.

type SearchHit = {
  type: 'household' | 'member' | 'agency' | 'referral' | 'policy' | 'document'
  id: string
  title: string
  subtitle: string | null
  href: string
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
    const [households, members, agencies, referrals, policies, carrierPolicies, documents] = await Promise.all([
      db.from('households').select('id, primary_name, city, state').ilike('primary_name', s.like).is('deleted_at', null).limit(limit),
      db.from('household_members').select('id, household_id, full_name, relationship').or(memberFilter.join(',')).is('deleted_at', null).limit(limit),
      db
        .from('agency_partnerships')
        .select('id, agency_name, owner_name')
        .or(`agency_name.ilike.${s.like},owner_name.ilike.${s.like}`)
        .is('deleted_at', null)
        .limit(limit),
      db.from('referrals').select('id, referred_name, status').ilike('referred_name', s.like).is('deleted_at', null).limit(limit),
      // Policy search by policy number, series code, AOR code, or product/LOB (§11).
      // Firewall (guardrail 1): is_security rows are EXCLUDED — a securities record
      // never surfaces through search, and only non-substantive fields are read.
      db
        .from('household_policies')
        .select('id, policy_number, product_name, series_code')
        .or(`policy_number.ilike.${s.like},series_code.ilike.${s.like},aor_code.ilike.${s.like},product_name.ilike.${s.like}`)
        .eq('is_security', false)
        .is('deleted_at', null)
        .limit(limit),
      // Carrier search — inner-join carriers by name, resolving to the policy.
      db
        .from('household_policies')
        .select('id, policy_number, product_name, carriers!inner(name)')
        .ilike('carriers.name', s.like)
        .eq('is_security', false)
        .is('deleted_at', null)
        .limit(limit),
      // Document search by (non-substantive) classification label.
      db.from('documents').select('id, classification, entity_type').ilike('classification', s.like).limit(limit),
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
    // Merge field-matched + carrier-matched policies, deduped by id. Normalize the
    // carrier-query rows (which embed `carriers` instead of `series_code`).
    const seenPolicy = new Set<string>()
    const policyHits: { id: string; policy_number: string | null; product_name: string | null; series_code: string | null }[] = [
      ...(policies.data ?? []),
      ...(carrierPolicies.data ?? []).map((p) => ({ id: p.id, policy_number: p.policy_number, product_name: p.product_name, series_code: null })),
    ]
    for (const p of policyHits) {
      if (seenPolicy.has(p.id)) continue
      seenPolicy.add(p.id)
      results.push({
        type: 'policy',
        id: p.id,
        title: p.policy_number || 'Policy',
        subtitle: p.product_name || p.series_code || 'Policy',
        href: `/app/policies/${p.id}`,
      })
    }
    for (const d of documents.data ?? []) {
      results.push({
        type: 'document',
        id: d.id,
        title: d.classification || 'Document',
        subtitle: d.entity_type || null,
        href: `/app/documents/${d.id}`,
      })
    }

    return NextResponse.json({ results: results.slice(0, limit * 3) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Search failed' }, { status: 500 })
  }
}
