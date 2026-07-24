import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { getPlan, approveVersion } from '@/lib/fna/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/fna/plans/[id]/approve — approve the plan's current version so it may
// be presented to a client (build instruction §4 — only an APPROVED version is
// client-presentable). Roles: fsa, licensed_staff (+ super_admin). Audits
// approval.decided.
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
    if (!plan.data.current_version_id) return NextResponse.json({ error: 'Calculate the plan before approving.' }, { status: 422 })

    const res = await approveVersion(plan.data.current_version_id, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid_transition' ? 409 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'approval.decided',
      entity: 'fna_version',
      entityId: res.data.id,
      diff: { event: 'fna.version.approved', plan_id: params.id, version_no: res.data.version_no },
    })
    return NextResponse.json({ version_id: res.data.id, version_no: res.data.version_no, status: 'APPROVED' }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to approve' }, { status: 500 })
  }
}
