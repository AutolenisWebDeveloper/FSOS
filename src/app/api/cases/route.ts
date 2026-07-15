import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf, hasSecuritiesScope } from '@/lib/auth/api'
import { CaseCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-10 Case Management (NIGO-free). A case tracks a life/financial application
// from submission → issue → service. No defect-prevention/NIGO scoring anywhere.
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const status = new URL(req.url).searchParams.get('status')
    let q = getDb().from('cases').select('*').is('archived_at', null).order('created_at', { ascending: false })
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ cases: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Create from an opportunity → carries household, product, carrier, is_security.
// A securities case requires securities scope (firewall); it stores only a pointer.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CaseCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid case', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: opp } = await db.from('opportunities').select('id, household_id, is_security, ffs_case_ref, referring_agency_id').eq('id', v.data.opportunity_id).is('deleted_at', null).maybeSingle()
    if (!opp) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })

    if (opp.is_security && !hasSecuritiesScope(auth.session)) {
      await db.from('compliance_events').insert({ kind: 'firewall', actor, entity_type: 'case', blocked_step: 'securities_scope', reason: 'Securities case requires securities scope.' })
      await writeAudit({ actor, action: 'firewall.blocked', entity: 'case', diff: { opportunity_id: opp.id } })
      return NextResponse.json({ error: 'Securities case requires securities scope. Escalated.', reason: 'securities_scope' }, { status: 403 })
    }

    // Idempotency: one case per opportunity (no duplicate case on retry).
    const { data: existing } = await db.from('cases').select('id').eq('opportunity_id', opp.id).limit(1).maybeSingle()
    if (existing) return NextResponse.json({ case: existing, idempotent: true }, { status: 200 })

    const { data, error } = await db
      .from('cases')
      .insert({
        opportunity_id: opp.id,
        household_id: opp.household_id,
        carrier_id: v.data.carrier_id ?? null,
        status: 'submitted',
        is_security: opp.is_security,
        ffs_case_ref: opp.is_security ? (opp.ffs_case_ref ?? 'pending-ffs') : null,
        submitted_at: new Date().toISOString(),
        owner_scope: actor,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'case', entityId: data.id, diff: { opportunity_id: opp.id, is_security: opp.is_security } })
    return NextResponse.json({ case: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create case' }, { status: 500 })
  }
}
