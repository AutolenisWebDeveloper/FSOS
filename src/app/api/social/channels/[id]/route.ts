import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ChannelUpdateSchema } from '@/lib/social/schema'
import { updateChannel, disconnectChannel } from '@/lib/social/channels'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ChannelUpdateSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  }

  const actor = actorOf(auth.session)
  try {
    const res = await updateChannel(id, v.data, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid' ? 400 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'social_channel',
      entityId: id,
      diff: { event: 'social.channel.updated', fields: Object.keys(v.data) },
    })
    return NextResponse.json({ channel: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update channel' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const actor = actorOf(auth.session)
  try {
    const res = await disconnectChannel(id, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.deleted',
      entity: 'social_channel',
      entityId: id,
      diff: { event: 'social.channel.disconnected' },
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to disconnect channel' }, { status: 500 })
  }
}
