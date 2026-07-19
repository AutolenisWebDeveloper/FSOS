import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf, hasSecuritiesScope } from '@/lib/auth/api'
import { OpportunityCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { assertNotSecuritiesSystemOfRecord, FirewallError } from '@/lib/compliance/firewall'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const household = new URL(req.url).searchParams.get('household')
    let q = getDb().from('opportunities').select('*').is('deleted_at', null).order('created_at', { ascending: false })
    if (household) q = q.eq('household_id', household)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ opportunities: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = OpportunityCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid opportunity', details: v.error.flatten() }, { status: 400 })

  try {
    assertNotSecuritiesSystemOfRecord(v.data)
  } catch (e) {
    if (e instanceof FirewallError) return NextResponse.json({ error: e.message, reason: 'firewall' }, { status: 422 })
    throw e
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    let isSecurity = false
    let licenseBasis: string | null = null
    if (v.data.product_id) {
      const { data: product } = await db.from('products').select('is_security, required_license').eq('id', v.data.product_id).maybeSingle()
      isSecurity = product?.is_security === true
      licenseBasis = product?.required_license ?? null
    }
    if (isSecurity && !hasSecuritiesScope(auth.session)) {
      await db.from('compliance_events').insert({ kind: 'firewall', actor, entity_type: 'opportunity', blocked_step: 'securities_scope', reason: 'Actor lacks securities registration.' })
      await db.from('agent_actions').insert({ kind: 'escalation', actor, outcome: 'escalated', target_type: 'opportunity', reason: 'securities scope', note: 'Securities opportunity requires FFS-approved channel.' })
      await writeAudit({ actor, action: 'firewall.blocked', entity: 'opportunity', diff: { step: 'securities_scope' } })
      return NextResponse.json({ error: 'Securities product requires securities scope. Escalated.', reason: 'securities_scope' }, { status: 403 })
    }

    const { data, error } = await db
      .from('opportunities')
      .insert({
        household_id: v.data.household_id,
        engagement: v.data.engagement,
        product_id: v.data.product_id ?? null,
        referring_agency_id: v.data.referring_agency_id ?? null,
        referral_id: v.data.referral_id ?? null,
        stage: 'prospect',
        is_security: isSecurity,
        license_basis_used: licenseBasis,
        premium: v.data.expected_premium ?? null,
        aum: v.data.expected_aum ?? null,
        expected_commission: v.data.expected_commission ?? null,
        stage_history: [{ stage: 'prospect', at: new Date().toISOString(), actor }],
        owner_scope: actor,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'opportunity', entityId: data.id, diff: { household_id: data.household_id, is_security: isSecurity } })
    await writeAudit({ actor, action: 'stage.changed', entity: 'opportunity', entityId: data.id, diff: { from: null, to: 'prospect' } })
    return NextResponse.json({ opportunity: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create opportunity' }, { status: 500 })
  }
}
