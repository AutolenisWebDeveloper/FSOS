import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { approveRecommendation } from '@/lib/fna/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/fna/recommendations/[id]/approve — the licensed FSA approves a
// human-authored recommendation (records reviewer + timestamp; §1 governance).
// Roles: fsa, licensed_staff (+ super_admin). Audits approval.decided.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const actor = actorOf(auth.session)
  try {
    const res = await approveRecommendation(params.id, actor)
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: res.kind === 'not_found' ? 404 : 500 })
    await writeAudit({
      actor,
      action: 'approval.decided',
      entity: 'fna_recommendation',
      entityId: res.data.id,
      diff: { event: 'fna.recommendation.approved', plan_id: res.data.plan_id },
    })
    return NextResponse.json({ recommendation_id: res.data.id, status: 'APPROVED' }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to approve recommendation' }, { status: 500 })
  }
}
