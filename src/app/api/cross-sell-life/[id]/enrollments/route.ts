import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { parseLimit, configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'
import { ENROLLMENT_STATES } from '@/lib/cross-sell-life/states'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Paged enrollment list for the queue / active / enrollment-management views. Read-only; FSA portal.
// Optional status filter is validated against the §15 enrollment-state vocabulary so an arbitrary
// value can't be pushed at the store. Ordered newest-touched first, with an exact total count.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const { id } = await props.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  const params = req.nextUrl.searchParams
  const status = params.get('status')
  if (status && !(ENROLLMENT_STATES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
  }
  const limit = parseLimit(params.get('limit'), 50, 200)
  const offsetRaw = Number.parseInt(params.get('offset') ?? '', 10)
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0

  try {
    const db = getDb()
    let query = db
      .from('xsell_life_campaign_enrollments')
      .select(
        'id, household_id, member_id, status, current_touch_no, next_touch_at, exit_reason, assigned_advisor, enrolled_at, updated_at',
        { count: 'exact' },
      )
      .eq('campaign_id', id)
    if (status) query = query.eq('status', status)

    const { data, count } = await query.order('updated_at', { ascending: false }).range(offset, offset + limit - 1)

    return NextResponse.json({ enrollments: data ?? [], total: count ?? 0, limit, offset })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load enrollments' }, { status: 500 })
  }
}
