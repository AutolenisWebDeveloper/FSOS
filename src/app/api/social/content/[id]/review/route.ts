import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ReviewDecisionSchema } from '@/lib/social/schema'
import { approve, decline } from '@/lib/social/content'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The human approval gate. Only a licensed human (FSA / licensed staff / super) may
// decide — the AI can never reach this route. Approving freezes the version.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ReviewDecisionSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid decision', details: v.error.flatten() }, { status: 400 })

  const approver = actorOf(auth.session)
  try {
    const res =
      v.data.decision === 'approved'
        ? await approve(id, v.data.version_id, approver, v.data.notes)
        : await decline(id, v.data.version_id, v.data.decision, approver, v.data.notes)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid_transition' ? 409 : 400
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor: approver,
      action: 'approval.decided',
      entity: 'social_content',
      entityId: id,
      diff: { event: 'social.content.reviewed', decision: v.data.decision, version_id: v.data.version_id },
    })
    return NextResponse.json({ content: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to record decision' }, { status: 500 })
  }
}
