import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, dbErrorResponse, parseLimit } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Two-way inbox — list conversation threads (most-recent first), optionally
// filtered by channel or status. Each thread is one contact on one channel with
// full history auto-associated to member/household/agency.
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const channel = req.nextUrl.searchParams.get('channel')?.trim() || ''
  const status = req.nextUrl.searchParams.get('status')?.trim() || ''
  const limit = parseLimit(req.nextUrl.searchParams.get('limit'), 100, 200)

  try {
    let builder = getDb()
      .from('comm_conversations')
      .select('id, channel, contact, member_id, household_id, agency_id, subject, status, is_security, ai_autoreply, unread_count, last_message_at, last_direction, updated_at')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit)
    if (channel === 'sms' || channel === 'email') builder = builder.eq('channel', channel)
    if (status) builder = builder.eq('status', status)
    const { data, error } = await builder
    if (error) return dbErrorResponse('comms/conversations', error)
    return NextResponse.json({ conversations: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
