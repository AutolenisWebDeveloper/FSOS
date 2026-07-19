import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/campaigns/enroll  (internal)
// Enroll contacts into a campaign by pipeline (scores.primary_pipeline),
// source (customers.source), and/or an explicit customer_ids list. Idempotent:
// re-enrolling an already-enrolled contact is skipped (unique constraint).
const Schema = z.object({
  campaign_id: z.string().uuid(),
  pipeline: z.string().max(40).optional(),
  source: z.string().max(40).optional(),
  customer_ids: z.array(z.string().uuid()).max(2000).optional(),
})

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = Schema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid enrollment', details: v.error.flatten() }, { status: 400 })
  const { campaign_id, pipeline, source, customer_ids } = v.data
  if (!pipeline && !source && !(customer_ids && customer_ids.length)) {
    return NextResponse.json({ error: 'Provide pipeline, source, or customer_ids' }, { status: 400 })
  }

  const supabase = getDb()
  const { data: campaign } = await supabase.from('campaigns').select('campaign_id').eq('campaign_id', campaign_id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const ids = new Set<string>(customer_ids || [])

  if (pipeline) {
    const { data } = await supabase.from('scores').select('customer_id').eq('primary_pipeline', pipeline).limit(5000)
    for (const r of data || []) ids.add(r.customer_id)
  }
  if (source) {
    const { data } = await supabase.from('customers').select('customer_id').eq('source', source).limit(5000)
    for (const r of data || []) ids.add(r.customer_id)
  }
  if (ids.size === 0) return NextResponse.json({ enrolled: 0, matched: 0 })

  // Upsert enrollments; ignore duplicates on the (campaign_id, customer_id) unique.
  const rows = Array.from(ids).map((customer_id) => ({ campaign_id, customer_id }))
  const { data: inserted, error } = await supabase
    .from('campaign_enrollments')
    .upsert(rows, { onConflict: 'campaign_id,customer_id', ignoreDuplicates: true })
    .select('enrollment_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ matched: ids.size, enrolled: inserted?.length || 0 })
}
