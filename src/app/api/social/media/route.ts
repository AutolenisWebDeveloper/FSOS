// Social media library — list (ADR-026, item 2). Staff-only. Returns safe asset
// views with fresh signed preview URLs; never the raw storage path or a public URL.

import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission } from '@/lib/auth/api'
import { listMediaAssets } from '@/lib/social/media-service'
import type { MediaKind } from '@/lib/social/media'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const kindParam = req.nextUrl.searchParams.get('kind')
  const kind = kindParam === 'image' || kindParam === 'video' ? (kindParam as MediaKind) : undefined

  try {
    const res = await listMediaAssets({ kind })
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 500 })
    return NextResponse.json({ assets: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load media' }, { status: 500 })
  }
}
