import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { getPlan, saveInputs } from '@/lib/fna/store'
import { loadFnaContext } from '@/lib/fna/household-fna'
import { mapContextToInputs } from '@/lib/fna/prefill'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/fna/plans/[id]/prefill — seed structured inputs from existing FSOS
// data (household, members, policies) so intake starts populated (build
// instruction §5). Every seeded value is labeled 'imported' — a starting value the
// FSA confirms, never presented as verified. Securities policies are excluded
// upstream by the pure mapper (§4.1). Roles: fsa, licensed_staff (+ super_admin).
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const actor = actorOf(auth.session)
  try {
    const plan = await getPlan(params.id)
    if (!plan.ok) return NextResponse.json({ error: plan.message }, { status: plan.kind === 'not_found' ? 404 : 500 })

    const ctx = await loadFnaContext(plan.data.household_id)
    if ('error' in ctx) {
      const e = ctx.error
      if (e.ok) return NextResponse.json({ error: 'context unavailable' }, { status: 500 })
      const status = e.kind === 'not_found' ? 404 : e.kind === 'error' ? 500 : 422
      const message = 'message' in e ? e.message : 'context unavailable'
      return NextResponse.json({ error: message }, { status })
    }

    const suggestions = mapContextToInputs(ctx)
    if (suggestions.length === 0) {
      return NextResponse.json({ written: 0, note: 'No prefillable data found on the household.' }, { status: 200 })
    }

    const res = await saveInputs(params.id, suggestions, actor)
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 500 })

    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'fna_plan',
      entityId: params.id,
      diff: { event: 'fna.inputs.prefilled', written: res.data.written, source: 'household_context' },
    })
    const values = Object.fromEntries(suggestions.map((s) => [s.key, s.value_numeric]))
    return NextResponse.json({ written: res.data.written, values }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to prefill' }, { status: 500 })
  }
}
