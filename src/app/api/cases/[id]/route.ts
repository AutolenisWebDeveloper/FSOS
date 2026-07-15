import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { CaseStatusSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('cases').select('*').eq('id', params.id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ case: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// PATCH status — board drag / detail update. issued → prompts the commission record (WF-1/7).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CaseStatusSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid status', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: c } = await db.from('cases').select('*').eq('id', params.id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const from = c.status as string
    const update: Record<string, unknown> = { status: v.data.status, updated_at: new Date().toISOString() }
    if (v.data.status === 'issued' && !c.issued_at) update.issued_at = new Date().toISOString()
    const { error } = await db.from('cases').update(update).eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'stage.changed', entity: 'case', entityId: params.id, diff: { from, to: v.data.status } })

    // On issue → advance the opportunity to placed_issued (which prompts the commission).
    let commissionId: string | null = null
    if (v.data.status === 'issued' && from !== 'issued' && c.opportunity_id) {
      const { data: opp } = await db.from('opportunities').select('id, stage, product_id, referring_agency_id, is_security, expected_commission').eq('id', c.opportunity_id).maybeSingle()
      if (opp && opp.stage !== 'placed_issued') {
        await db.from('opportunities').update({ stage: 'placed_issued', updated_at: new Date().toISOString() }).eq('id', opp.id)
        await writeAudit({ actor, action: 'stage.changed', entity: 'opportunity', entityId: opp.id, diff: { from: opp.stage, to: 'placed_issued', via: 'case_issue' } })
        let family = 'life'
        if (opp.product_id) { const { data: p } = await db.from('products').select('family').eq('id', opp.product_id).maybeSingle(); if (p?.family) family = p.family }
        const { data: exists } = await db.from('commissions').select('id').eq('opportunity_id', opp.id).limit(1).maybeSingle()
        if (!exists) {
          const { data: split } = await db.from('commission_splits').select('fsa_split_pct, agency_split_pct').eq('product_family', family).is('agency_id', null).limit(1).maybeSingle()
          const { data: comm } = await db.from('commissions').insert({ opportunity_id: opp.id, referring_agency_id: opp.referring_agency_id, product_family: family, is_security: opp.is_security, total_commission: Number(opp.expected_commission ?? 0), fsa_split_pct: split?.fsa_split_pct ?? null, agency_split_pct: split?.agency_split_pct ?? null, reconciliation_status: 'expected', owner_scope: actor }).select('id').maybeSingle()
          commissionId = comm?.id ?? null
          if (commissionId) await writeAudit({ actor, action: 'entity.created', entity: 'commission', entityId: commissionId, diff: { opportunity_id: opp.id, from_split_defaults: true } })
        }
      }
    }
    return NextResponse.json({ ok: true, status: v.data.status, commission_id: commissionId })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
