import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { createNewVersion, CONTROL_ROLES } from '@/lib/cross-sell-life/controls'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// New version (§16): an Active version is immutable — editing forks a new Draft version that shares
// the family_key and copies the touch template. Existing enrollments stay pinned to their version.
// Restricted to ops/admin/super/fsa; audit-logged with the new version + source campaign.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, CONTROL_ROLES)
  if (denied) return denied

  const { id } = await props.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  try {
    const result = await createNewVersion({ campaignId: id, actor: actorOf(auth.session) })
    if (!result.ok) return NextResponse.json(result, { status: result.error === 'campaign_missing' ? 404 : 409 })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Versioning failed' }, { status: 500 })
  }
}
