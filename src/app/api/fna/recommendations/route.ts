import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { createRecommendation, RecommendationSchema } from '@/lib/fna/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/fna/recommendations — persist a HUMAN-authored recommendation with its
// Reg-BI governance capture (build instruction §1). The system never GENERATES a
// recommendation; this only stores what the licensed FSA wrote, pinned to the FNA
// version. Roles: fsa, licensed_staff (+ super_admin). Audits fna.recommendation.created.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<unknown>(req)
  if ('error' in parsed) return parsed.error
  const body = RecommendationSchema.safeParse(parsed.data)
  if (!body.success) return NextResponse.json({ error: 'invalid recommendation', details: body.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const res = await createRecommendation(body.data, actor)
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 500 })
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'fna_recommendation',
      entityId: res.data.id,
      diff: { event: 'fna.recommendation.created', plan_id: body.data.plan_id, product_category: body.data.product_category ?? null },
    })
    return NextResponse.json({ recommendation_id: res.data.id }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to save recommendation' }, { status: 500 })
  }
}
