import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { submitForReview } from '@/lib/social/content'

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
    const res = await submitForReview(id, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid_transition' ? 409 : 400
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({ actor, action: 'stage.changed', entity: 'social_content', entityId: id, diff: { event: 'social.content.submitted', version_id: res.data.id, version_no: res.data.version_no } })
    return NextResponse.json({ version: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to submit for review' }, { status: 500 })
  }
}
