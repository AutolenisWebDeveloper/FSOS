import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { GdcTierSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Legacy-port GDC tier config (docs/legacy-port.md §2.2). GUARDRAIL 3: tier
// thresholds/payouts are assumption-flagged config DEFAULTS — never Farmers-published
// figures. Editing a tier keeps is_assumption = true (verification is a contract
// action, not a UI toggle). Every change is audited before/after. Super-only.
export async function GET() {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('gdc_tiers').select('*').order('min_gdc', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ tiers: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Upsert a tier (keyed by tier_no). Only super_admin may edit config.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = GdcTierSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid tier', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    const { data: before } = await db.from('gdc_tiers').select('*').eq('tier_no', v.data.tier_no).maybeSingle()

    const row = {
      tier_no: v.data.tier_no,
      label: v.data.label,
      min_gdc: v.data.min_gdc,
      max_gdc: v.data.max_gdc ?? null,
      payout_pct: v.data.payout_pct,
      is_assumption: true, // guardrail 3 — remains a config default until contract-confirmed
      note: v.data.note ?? 'config default — verify; not a Farmers-published figure',
      updated_at: new Date().toISOString(),
    }

    const result = before
      ? await db.from('gdc_tiers').update(row).eq('id', before.id).select('*').single()
      : await db.from('gdc_tiers').insert(row).select('*').single()
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })

    await writeAudit({
      actor,
      action: 'config.changed',
      entity: 'gdc_tier',
      entityId: result.data.id,
      diff: {
        tier_no: v.data.tier_no,
        before: before
          ? { min_gdc: before.min_gdc, max_gdc: before.max_gdc, payout_pct: before.payout_pct, label: before.label }
          : null,
        after: { min_gdc: row.min_gdc, max_gdc: row.max_gdc, payout_pct: row.payout_pct, label: row.label },
      },
    })
    return NextResponse.json({ tier: result.data }, { status: before ? 200 : 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to save tier' }, { status: 500 })
  }
}
