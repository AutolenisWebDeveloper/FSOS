import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — the AI Workforce "today" summary. Per-agent quota vs. work done (from
// v_workforce_today) plus the most recent queue items, so the FSA can see the
// employees operating in real time. Read-only.
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  try {
    const db = getDb()
    const [summary, recent] = await Promise.all([
      db.from('v_workforce_today').select('*').order('agent_key'),
      db
        .from('outreach_queue')
        .select('id, agent_key, source, channel, priority, reason, status, block_reason, outcome, created_at')
        .eq('queue_date', new Date().toISOString().slice(0, 10))
        .order('priority', { ascending: false })
        .limit(100),
    ])
    if (summary.error) return NextResponse.json({ error: summary.error.message }, { status: 500 })
    if (recent.error) return NextResponse.json({ error: recent.error.message }, { status: 500 })
    return NextResponse.json({ summary: summary.data ?? [], recent: recent.data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
