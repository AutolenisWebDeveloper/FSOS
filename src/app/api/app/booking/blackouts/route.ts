import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { BlackoutCreate } from '@/lib/booking/config-schemas'
import { listBlackouts, createBlackout } from '@/lib/booking/config'
import { configErrorToResponse } from '@/lib/booking/route-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/app/booking/blackouts — list blackout ranges.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const res = await listBlackouts()
    if (!res.ok) return configErrorToResponse(res, 'list blackouts')
    return NextResponse.json({ blackouts: res.data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load blackouts' }, { status: 500 })
  }
}

// POST /api/app/booking/blackouts — add a blackout range.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = BlackoutCreate.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid blackout', details: v.error.flatten() }, { status: 400 })

  try {
    const res = await createBlackout(actorOf(auth.session), v.data)
    if (!res.ok) return configErrorToResponse(res, 'create blackout')
    return NextResponse.json({ id: res.data.id }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create blackout' }, { status: 500 })
  }
}
