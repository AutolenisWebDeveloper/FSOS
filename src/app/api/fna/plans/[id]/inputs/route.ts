import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse, storeErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { saveInputs, getPlan, FnaInputSchema } from '@/lib/fna/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BodySchema = z.object({ inputs: z.array(FnaInputSchema).max(500) })

// POST /api/fna/plans/[id]/inputs — save structured intake inputs for a plan
// (save-and-resume; build instruction §5). Additive rows so conflicting sources
// are preserved + detected. Never blocks on incompleteness. Audits fna.inputs.saved.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<unknown>(req)
  if ('error' in parsed) return parsed.error
  const body = BodySchema.safeParse(parsed.data)
  if (!body.success) return NextResponse.json({ error: 'invalid inputs', details: body.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const plan = await getPlan(params.id)
    if (!plan.ok) return storeErrorResponse(plan, 'fna.inputs.getPlan')

    const res = await saveInputs(params.id, body.data.inputs, actor)
    if (!res.ok) return storeErrorResponse(res, 'fna.inputs.save')

    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'fna_plan',
      entityId: params.id,
      diff: { event: 'fna.inputs.saved', written: res.data.written, conflicts: res.data.conflicts },
    })
    return NextResponse.json({ written: res.data.written, conflicts: res.data.conflicts }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to save inputs' }, { status: 500 })
  }
}
