// Social media asset — get / soft-delete (ADR-026, item 2). Staff-only.

import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { getMediaAsset, softDeleteMediaAsset } from '@/lib/social/media-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params
  try {
    const res = await getMediaAsset(id)
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: res.kind === 'not_found' ? 404 : 500 })
    return NextResponse.json({ asset: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load asset' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params
  const actor = actorOf(auth.session)
  try {
    const res = await softDeleteMediaAsset(id, actor)
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: res.kind === 'not_found' ? 404 : 500 })
    await writeAudit({ actor, action: 'entity.deleted', entity: 'social_media_asset', entityId: id, diff: { event: 'social.media.deleted' } })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 })
  }
}
