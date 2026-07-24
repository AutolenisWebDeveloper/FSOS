import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse, storeErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { getPlan, getPlanInputs, getActiveAssumptionSet, createVersion } from '@/lib/fna/store'
import { normalizeInputs, calculatePlan } from '@/lib/fna/calculate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/fna/plans/[id]/calculate — run the deterministic engine over the plan's
// structured inputs and freeze an immutable version with per-formula results
// (ADR-015/016). No AI, no figure from a model. Never blocks on incomplete inputs.
// Roles: fsa, licensed_staff (+ super_admin). Audits fna.plan.calculated.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const actor = actorOf(auth.session)
  try {
    const plan = await getPlan(params.id)
    if (!plan.ok) return storeErrorResponse(plan, 'calculate:getPlan')

    const inputsRes = await getPlanInputs(params.id)
    if (!inputsRes.ok) return storeErrorResponse(inputsRes, 'calculate:getPlanInputs')

    const assumptions = await getActiveAssumptionSet(plan.data.household_id)
    const values = normalizeInputs(inputsRes.data)
    const computedAt = new Date().toISOString()
    const calc = calculatePlan(plan.data.plan_type, values, assumptions, { computedAt })

    const version = await createVersion(params.id, {
      assumptionSet: assumptions,
      inputsSnapshot: { values, completeness: calc.completeness, missingFields: calc.missingFields },
      results: calc.results.map((r) => ({
        formula_id: r.formula_id,
        formula_version: r.formula_version,
        envelope: r.envelope,
        confidence: r.confidence,
      })),
      status: 'CALCULATED',
      actor,
    })
    if (!version.ok) return storeErrorResponse(version, 'calculate:createVersion')

    // The engine is DETERMINISTIC (no model), so this is an entity mutation, not an
    // AI run — logging it as ai.run would pollute the AI-governance audit trail (§13.9).
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'fna_version',
      entityId: version.data.id,
      diff: { event: 'fna.plan.calculated', plan_id: params.id, version_no: version.data.version_no, formulas: calc.results.length, completeness: calc.completeness },
    })

    return NextResponse.json(
      { version_id: version.data.id, version_no: version.data.version_no, completeness: calc.completeness, missingFields: calc.missingFields, results: calc.results.length },
      { status: 201 },
    )
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to calculate plan' }, { status: 500 })
  }
}
