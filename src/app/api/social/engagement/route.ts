import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission } from '@/lib/auth/api'
import { listEngagement } from '@/lib/social/engagement'
import type { ResolutionStatus } from '@/lib/social/triage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUSES = ['unmatched', 'matched', 'triaged', 'dismissed']

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const p = req.nextUrl.searchParams.get('status')
  const status = p && STATUSES.includes(p) ? (p as ResolutionStatus) : undefined
  try {
    const res = await listEngagement({ status })
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 500 })
    return NextResponse.json({ engagement: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load engagement' }, { status: 500 })
  }
}
