import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf, hasSecuritiesScope } from '@/lib/auth/api'
import { OpportunityStageSchema, OPPORTUNITY_STAGE } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Securities-scope gate: an actor without securities registration cannot advance an
// is_security opportunity past this stage (rbac-matrix; block + escalate + firewall event).
const SECURITIES_STAGE_LIMIT_INDEX = OPPORTUNITY_STAGE.indexOf('quoted_proposed')

// POST /api/opportunities/[id]/stage 🛡 — drag/advance. Writes stage_history + audit.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = OpportunityStageSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid stage', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: opp } = await db.from('opportunities').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle()
    if (!opp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const from = opp.stage as string
    const to = v.data.stage
    const toIndex = OPPORTUNITY_STAGE.indexOf(to)

    if (opp.is_security && !hasSecuritiesScope(auth.session) && toIndex > SECURITIES_STAGE_LIMIT_INDEX) {
      await db.from('compliance_events').insert({ kind: 'firewall', actor, entity_type: 'opportunity', entity_id: params.id, blocked_step: 'securities_scope', reason: `Cannot advance securities opportunity to ${to} without securities scope.` })
      await db.from('agent_actions').insert({ kind: 'escalation', actor, outcome: 'escalated', target_type: 'opportunity', target_id: params.id, reason: 'securities scope', note: `Advance to ${to} routed to FFS-approved handling.` })
      await writeAudit({ actor, action: 'firewall.blocked', entity: 'opportunity', entityId: params.id, diff: { attempted_stage: to } })
      return NextResponse.json({ error: 'Securities scope required to advance this opportunity. Escalated to FFS handling.', reason: 'securities_scope' }, { status: 403 })
    }

    const history = Array.isArray(opp.stage_history) ? opp.stage_history : []
    history.push({ stage: to, at: new Date().toISOString(), actor, note: v.data.note ?? null })

    const update: Record<string, unknown> = { stage: to, stage_history: history, updated_at: new Date().toISOString() }
    if (to === 'lost' && v.data.note) update.lost_reason = v.data.note

    const { error } = await db.from('opportunities').update(update).eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'stage.changed', entity: 'opportunity', entityId: params.id, diff: { from, to } })

    // placed_issued → prompt a commission record from assumption-flagged split defaults.
    let commissionId: string | null = null
    if (to === 'placed_issued' && from !== 'placed_issued') {
      let family = 'life'
      if (opp.product_id) {
        const { data: product } = await db.from('products').select('family').eq('id', opp.product_id).maybeSingle()
        if (product?.family) family = product.family
      }
      const { data: existing } = await db.from('commissions').select('id').eq('opportunity_id', params.id).limit(1).maybeSingle()
      if (!existing) {
        const { data: split } = await db.from('commission_splits').select('fsa_split_pct, agency_split_pct').eq('product_family', family).is('agency_id', null).limit(1).maybeSingle()
        const { data: comm } = await db
          .from('commissions')
          .insert({
            opportunity_id: params.id,
            referring_agency_id: opp.referring_agency_id,
            product_family: family,
            is_security: opp.is_security,
            total_commission: Number(opp.expected_commission ?? 0),
            fsa_split_pct: split?.fsa_split_pct ?? null,
            agency_split_pct: split?.agency_split_pct ?? null,
            reconciliation_status: 'expected',
            owner_scope: actor,
          })
          .select('id')
          .maybeSingle()
        commissionId = comm?.id ?? null
        if (commissionId) await writeAudit({ actor, action: 'entity.created', entity: 'commission', entityId: commissionId, diff: { opportunity_id: params.id, from_split_defaults: true, product_family: family } })
      }
    }

    return NextResponse.json({ ok: true, stage: to, commission_id: commissionId })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
