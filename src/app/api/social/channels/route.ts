import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ChannelConnectSchema } from '@/lib/social/schema'
import { listChannels, connectChannel } from '@/lib/social/channels'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  try {
    const res = await listChannels()
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 500 })
    return NextResponse.json({ channels: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load channels' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ChannelConnectSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid channel', details: v.error.flatten() }, { status: 400 })
  }

  const actor = actorOf(auth.session)
  try {
    const res = await connectChannel(v.data, actor)
    if (!res.ok) {
      const status = res.kind === 'invalid' ? 400 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'social_channel',
      entityId: res.data.id,
      diff: { event: 'social.channel.connected', platform: v.data.platform },
    })
    return NextResponse.json({ channel: res.data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to register channel' }, { status: 500 })
  }
}
