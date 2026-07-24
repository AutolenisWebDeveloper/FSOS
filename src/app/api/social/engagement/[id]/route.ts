import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { LinkContactSchema } from '@/lib/social/schema'
import { linkEngagementToContact, dismissEngagement } from '@/lib/social/engagement'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH → link the engagement to an EXISTING contact (review-queue triage).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = LinkContactSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid link', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const res = await linkEngagementToContact(id, v.data.contact_id, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid' ? 422 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'social_engagement',
      entityId: id,
      diff: { event: 'social.engagement.linked', contact_id: v.data.contact_id },
    })
    return NextResponse.json({ engagement: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to link engagement' }, { status: 500 })
  }
}

// DELETE → dismiss (mark handled, no CRM record).
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const actor = actorOf(auth.session)
  try {
    const res = await dismissEngagement(id, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({ actor, action: 'entity.updated', entity: 'social_engagement', entityId: id, diff: { event: 'social.engagement.dismissed' } })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to dismiss engagement' }, { status: 500 })
  }
}
