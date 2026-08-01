import { NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Communications Command Console (spec §B1/§4) — the agent picker for operator-initiated
// AI conversations. Returns ENABLED agents only, with the Compliance Guardrail EXCLUDED:
// it is a system hard-block layer, never a conversational starter (spec §7). A disabled
// agent is never offered (and if it is disabled mid-flow the start route re-checks and
// blocks). This is a pure read over the ai_agents registry.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('ai_agents')
      .select('key, name, mission, enabled, is_guardrail')
      .eq('enabled', true)
      .eq('is_guardrail', false)
      .order('name', { ascending: true })
    if (error) return dbErrorResponse('comms/agents', error)
    return NextResponse.json({ agents: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load agents' }, { status: 500 })
  }
}
