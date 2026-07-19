import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { PolicyCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { assertNotSecuritiesSystemOfRecord, FirewallError } from '@/lib/compliance/firewall'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('household_policies')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ policies: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'ops', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PolicyCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid policy', details: v.error.flatten() }, { status: 400 })

  // Firewall: FSOS may never store substantive securities data on a policy.
  try {
    assertNotSecuritiesSystemOfRecord(v.data)
  } catch (e) {
    if (e instanceof FirewallError) return NextResponse.json({ error: e.message, reason: 'firewall' }, { status: 422 })
    throw e
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // is_security is derived from the product (never stored securities substance).
    let isSecurity = false
    if (v.data.product_id) {
      const { data: product } = await db.from('products').select('is_security').eq('id', v.data.product_id).maybeSingle()
      isSecurity = product?.is_security === true
    }

    const { data, error } = await db
      .from('household_policies')
      .insert({
        household_id: v.data.household_id,
        carrier_id: v.data.carrier_id ?? null,
        product_id: v.data.product_id ?? null,
        policy_number: v.data.policy_number ?? null,
        status: v.data.status,
        is_with_us: v.data.is_with_us,
        premium: v.data.premium ?? null,
        effective_date: v.data.effective_date ?? null,
        renewal_date: v.data.renewal_date ?? null,
        x_date: v.data.x_date ?? null,
        conversion_deadline: v.data.conversion_deadline ?? null,
        is_security: isSecurity,
        owner_scope: actor,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'policy', entityId: data.id, diff: { household_id: data.household_id, is_security: isSecurity, is_with_us: data.is_with_us } })
    return NextResponse.json({ policy: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to record policy' }, { status: 500 })
  }
}
