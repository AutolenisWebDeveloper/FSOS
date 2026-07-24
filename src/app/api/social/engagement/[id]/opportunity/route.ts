import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { createOpportunityFromEngagement } from '@/lib/social/engagement'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const actor = actorOf(auth.session)
  try {
    const res = await createOpportunityFromEngagement(id, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid' ? 422 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'opportunity',
      entityId: res.data.opportunityId,
      diff: { event: 'social.engagement.opportunity_created', engagement_id: id },
    })
    return NextResponse.json({ opportunity_id: res.data.opportunityId }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create opportunity' }, { status: 500 })
  }
}
