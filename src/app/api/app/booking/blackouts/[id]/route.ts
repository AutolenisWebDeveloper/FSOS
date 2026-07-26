import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { deleteBlackout } from '@/lib/booking/config'
import { configErrorToResponse } from '@/lib/booking/route-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// DELETE /api/app/booking/blackouts/[id] — remove a blackout range.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  try {
    const res = await deleteBlackout(actorOf(auth.session), id)
    if (!res.ok) return configErrorToResponse(res, 'delete blackout')
    return NextResponse.json({ id: res.data.id })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to delete blackout' }, { status: 500 })
  }
}
