import { NextRequest, NextResponse } from 'next/server'
import { requireInternalAuth } from '@/lib/http'
import { loadCustomerProfile } from '@/lib/customerProfile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/customers/detail?id=<uuid>  (internal)
// Full 360° profile for the Client Detail drawer: demographics, policies,
// scores, activity timeline, commission + OPRA cases, forms, and GHL summary.
export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const profile = await loadCustomerProfile(id)
  if (!profile) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  return NextResponse.json(profile)
}
