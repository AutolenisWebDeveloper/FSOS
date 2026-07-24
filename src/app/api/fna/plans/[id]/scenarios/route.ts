import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse, storeErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { getPlan, getVersionSnapshot, createScenario } from '@/lib/fna/store'
import { computeScenario, scenarioPreset, type ScenarioOverride } from '@/lib/fna/scenarios'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BodySchema = z.object({
  scenario_type: z.string().min(1).max(64),
  name: z.string().max(120).optional(),
  overrides: z
    .object({
      inputs: z.record(z.number().finite()).optional(),
      inputDeltas: z.record(z.number().finite()).optional(),
      assumptions: z.record(z.number().finite()).optional(),
    })
    .optional(),
})

// POST /api/fna/plans/[id]/scenarios — create a what-if scenario BRANCHED FROM the
// plan's current frozen version (build instruction §4). Applies preset and/or
// custom overrides, re-runs the deterministic engine, and stores the result —
// never mutating the base version. Roles: fsa, licensed_staff (+ super_admin).
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<unknown>(req)
  if ('error' in parsed) return parsed.error
  const body = BodySchema.safeParse(parsed.data)
  if (!body.success) return NextResponse.json({ error: 'invalid scenario', details: body.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const plan = await getPlan(params.id)
    if (!plan.ok) return storeErrorResponse(plan, 'fna.scenarios.getPlan')
    if (!plan.data.current_version_id) {
      return NextResponse.json({ error: 'Calculate the plan first — a scenario branches from a frozen version.' }, { status: 422 })
    }

    const snap = await getVersionSnapshot(plan.data.current_version_id)
    if (!snap.ok) return storeErrorResponse(snap, 'fna.scenarios.snapshot')

    const preset = scenarioPreset(body.data.scenario_type)
    // Merge preset override with any custom override (custom wins per field).
    const override: ScenarioOverride = {
      inputs: { ...(preset?.override.inputs ?? {}), ...(body.data.overrides?.inputs ?? {}) },
      inputDeltas: { ...(preset?.override.inputDeltas ?? {}), ...(body.data.overrides?.inputDeltas ?? {}) },
      assumptions: { ...(preset?.override.assumptions ?? {}), ...(body.data.overrides?.assumptions ?? {}) },
    }
    if (!preset && !body.data.overrides) {
      return NextResponse.json({ error: 'Unknown scenario_type and no custom overrides supplied.' }, { status: 400 })
    }

    const computedAt = new Date().toISOString()
    const calc = computeScenario(plan.data.plan_type, snap.data.values, snap.data.assumptionSet, override, { computedAt })

    const name = body.data.name || preset?.name || body.data.scenario_type
    const res = await createScenario(params.id, {
      baseVersionId: plan.data.current_version_id,
      name,
      scenarioType: body.data.scenario_type,
      overrides: override as Record<string, unknown>,
      results: { results: calc.results, completeness: calc.completeness },
      actor,
    })
    if (!res.ok) return storeErrorResponse(res, 'fna.scenarios.create')

    await writeAudit({
      actor,
      // Deterministic scenario engine — no model call. Audit as entity.created, not
      // ai.run, so this doesn't pollute the AI-governance audit trail (§13.9).
      action: 'entity.created',
      entity: 'fna_scenario',
      entityId: res.data.id,
      diff: { event: 'fna.scenario.created', plan_id: params.id, base_version_id: plan.data.current_version_id, scenario_type: body.data.scenario_type },
    })
    return NextResponse.json({ scenario_id: res.data.id, name }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create scenario' }, { status: 500 })
  }
}
