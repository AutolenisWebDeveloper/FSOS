import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { createPlan } from '@/lib/fna/store'
import { isKnownPlanType } from '@/lib/fna/plan-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/fna/plans — start a structured FNA plan for a household (ADR-016,
// build instruction §5). Thin: parse → authorize → service → typed response.
// Roles: fsa, licensed_staff (+ super_admin). Audits fna.plan.created.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<{ household_id?: string; plan_type?: string; title?: string; review_id?: string }>(req)
  if ('error' in parsed) return parsed.error
  const { household_id: householdId, plan_type: planType, title, review_id: reviewId } = parsed.data
  if (!householdId) return NextResponse.json({ error: 'household_id required' }, { status: 400 })
  if (!planType || !isKnownPlanType(planType)) return NextResponse.json({ error: 'valid plan_type required' }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const res = await createPlan(householdId, planType, { title, reviewId, actor })
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid_transition' ? 409 : 400
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'fna_plan',
      entityId: res.data.id,
      diff: { event: 'fna.plan.created', plan_type: planType, household_id: householdId },
    })
    return NextResponse.json({ plan: res.data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
  }
}
