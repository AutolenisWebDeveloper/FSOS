import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson } from '@/lib/http'
import { apolloEnabled, enrichPerson } from '@/lib/apollo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/customers/enrich  (internal)  body: { customer_id }
// Enriches a client via Apollo (title, company, industry, LinkedIn, seniority).
// Backfills employer/occupation on the customer when those are empty. Guarded:
// 503 without APOLLO_API_KEY.
export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  if (!apolloEnabled()) {
    return NextResponse.json({ error: 'Apollo is not configured (set APOLLO_API_KEY).', code: 'not_configured' }, { status: 503 })
  }

  const parsed = await readJson<{ customer_id?: string }>(req)
  if ('error' in parsed) return parsed.error
  const customerId = parsed.data.customer_id
  if (!customerId) return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })

  const supabase = getDb()
  const { data: customer, error } = await supabase
    .from('customers')
    .select('customer_id, first_name, last_name, email, employer, occupation')
    .eq('customer_id', customerId)
    .single()
  if (error || !customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  const result = await enrichPerson({
    email: customer.email,
    firstName: customer.first_name,
    lastName: customer.last_name,
    organization: customer.employer,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Enrichment failed' }, { status: result.status >= 400 ? 502 : 502 })
  }
  if (!result.person) {
    return NextResponse.json({ matched: false, message: 'No Apollo match found for this contact.' })
  }

  // Backfill company/title onto the customer only when those fields are empty.
  const update: Record<string, string> = {}
  if (!customer.employer && result.person.company) update.employer = result.person.company
  if (!customer.occupation && result.person.title) update.occupation = result.person.title
  if (Object.keys(update).length) {
    await supabase.from('customers').update(update).eq('customer_id', customerId)
  }

  return NextResponse.json({ matched: true, person: result.person, backfilled: update })
}
