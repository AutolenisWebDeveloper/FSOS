import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { CommissionSplitSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-11 Split Configuration (A10). Splits are labeled config defaults — NEVER a
// Farmers-published figure. Percentages must sum to 100 (schema + DB CHECK).
// Per-agency overrides supersede the null-agency default. Every change is audited
// before/after.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('commission_splits').select('*').order('product_family')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ splits: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Upsert a split (default or per-agency override). Only FSA/super may edit config.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CommissionSplitSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid split', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const agencyId = v.data.agency_id ?? null

    // Read the current value (for before/after audit).
    let existingQ = db.from('commission_splits').select('*').eq('product_family', v.data.product_family)
    existingQ = agencyId ? existingQ.eq('agency_id', agencyId) : existingQ.is('agency_id', null)
    const { data: before } = await existingQ.maybeSingle()

    const row = {
      product_family: v.data.product_family,
      agency_id: agencyId,
      fsa_split_pct: v.data.fsa_split_pct,
      agency_split_pct: v.data.agency_split_pct,
      is_assumption: true, // still an assumption until contract-confirmed at go-live
      note: v.data.note ?? 'config default — verify with contract; not a Farmers-published figure',
      updated_at: new Date().toISOString(),
    }

    let result
    if (before) {
      result = await db.from('commission_splits').update(row).eq('id', before.id).select('*').single()
    } else {
      result = await db.from('commission_splits').insert(row).select('*').single()
    }
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
    await writeAudit({
      actor,
      action: 'config.changed',
      entity: 'commission_split',
      entityId: result.data.id,
      diff: { before: before ? { fsa: before.fsa_split_pct, agency: before.agency_split_pct } : null, after: { fsa: v.data.fsa_split_pct, agency: v.data.agency_split_pct }, product_family: v.data.product_family, agency_id: agencyId },
    })
    return NextResponse.json({ split: result.data }, { status: before ? 200 : 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to save split' }, { status: 500 })
  }
}
