import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — the AI Escalations queue: every agent_actions row of kind='escalation'
// (the human-handoff surface), plus recent compliance_events for firewall/comms
// context. Read-only; resolution happens via PATCH on [id].
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  try {
    const db = getDb()
    const [escalations, complianceEvents] = await Promise.all([
      db
        .from('agent_actions')
        .select('id, run_id, kind, actor, outcome, target_type, target_id, reason, blocked_step, note, drafted_content, created_at')
        .eq('kind', 'escalation')
        .order('created_at', { ascending: false }),
      db
        .from('compliance_events')
        .select('id, kind, actor, channel, recipient, entity_type, entity_id, blocked_step, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(25),
    ])

    if (escalations.error) return NextResponse.json({ error: escalations.error.message }, { status: 500 })
    if (complianceEvents.error) return NextResponse.json({ error: complianceEvents.error.message }, { status: 500 })

    return NextResponse.json({
      escalations: escalations.data ?? [],
      compliance_events: complianceEvents.data ?? [],
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
