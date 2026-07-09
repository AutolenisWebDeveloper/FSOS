import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, parseLimit } from '@/lib/http'
import { ghlSummary } from '@/lib/ghl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/search?q=<term>&limit=8  (internal)
// Unified quick-search across customers and agencies for the command-center
// top bar. Matches name / email / phone (customers) and name / owner / email
// (agencies). Returns a flat, ranked result list the UI renders in a dropdown.
export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const limit = parseLimit(url.searchParams.get('limit'), 8, 20)
  if (q.length < 2) return NextResponse.json({ results: [] })

  const supabase = getDb()
  // Strip characters that are PostgREST .or() syntax (commas, parentheses,
  // wildcards) so a term like "Smith, John" can't break or broaden the filter,
  // then escape LIKE wildcards.
  const safe = q
    .replace(/[,()*]/g, ' ')
    .trim()
    .replace(/[%_\\]/g, (m) => `\\${m}`)
  if (!safe) return NextResponse.json({ results: [] })
  const like = `%${safe}%`
  const digits = q.replace(/\D/g, '')

  const customerFilter = [`first_name.ilike.${like}`, `last_name.ilike.${like}`, `email.ilike.${like}`]
  if (digits.length >= 3) {
    customerFilter.push(`phone.ilike.%${digits}%`, `cell_phone.ilike.%${digits}%`)
  }

  const [customersRes, agenciesRes] = await Promise.all([
    supabase
      .from('customers')
      .select(
        'customer_id, first_name, last_name, email, phone, city, state, ghl_contact_id, ghl_opportunity_id, ghl_stage_id',
      )
      .or(customerFilter.join(','))
      .limit(limit),
    supabase
      .from('agencies')
      .select('agency_id, name, owner, email, city, slug')
      .or([`name.ilike.${like}`, `owner.ilike.${like}`, `email.ilike.${like}`].join(','))
      .limit(limit),
  ])

  const results: Array<Record<string, unknown>> = []

  if (!customersRes.error && customersRes.data) {
    for (const c of customersRes.data) {
      const g = ghlSummary(c)
      results.push({
        type: 'customer',
        id: c.customer_id,
        title: `${c.first_name} ${c.last_name}`.trim(),
        subtitle: c.email || c.phone || [c.city, c.state].filter(Boolean).join(', '),
        stage: g.stage,
        pipeline: g.pipeline,
      })
    }
  }
  if (!agenciesRes.error && agenciesRes.data) {
    for (const a of agenciesRes.data) {
      results.push({
        type: 'agency',
        id: a.agency_id,
        title: a.name,
        subtitle: [a.owner, a.city].filter(Boolean).join(' · ') || a.email,
        slug: a.slug,
      })
    }
  }

  return NextResponse.json({ query: q, results })
}
