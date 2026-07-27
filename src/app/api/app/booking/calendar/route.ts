// Native booking — Google Calendar connection status + disconnect (Slice 7). FSA-guarded.
// GET returns a client-safe status (configured? connected? which account?) for the FSA
// booking settings; DELETE disconnects (soft-delete + clears the encrypted token). No token
// material is ever returned.

import { NextRequest, NextResponse } from 'next/server'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { configErrorResponse } from '@/lib/http'
import { googleCalendarConfigured } from '@/lib/booking/google/oauth'
import { getConnection, disconnectConnection } from '@/lib/booking/google/connection'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const host = actorOf(auth.session)
    const res = await getConnection(host)
    if (!res.ok) return NextResponse.json({ error: 'Failed to load calendar connection' }, { status: 500 })
    return NextResponse.json({ configured: googleCalendarConfigured(), connection: res.data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load calendar connection' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  try {
    const host = actorOf(auth.session)
    const res = await disconnectConnection(host, host)
    if (!res.ok) return NextResponse.json({ error: 'Failed to disconnect calendar' }, { status: 500 })
    return NextResponse.json({ ok: true, disconnected: !!res.data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to disconnect calendar' }, { status: 500 })
  }
}
