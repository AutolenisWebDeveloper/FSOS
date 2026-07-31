import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'
import { campaignAnalytics } from '@/lib/pipeline-winback/analytics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Pipeline Win-Back Campaign — list campaigns with their operational status + live analytics
// (§12/§13). Read-only; FSA portal (staff/ops/admin/compliance all reach the FSA portal group).
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data: campaigns } = await db
      .from('pipeline_winback_campaigns')
      .select('id, name, status, is_assumption, simulated_at, created_at')
      .order('created_at', { ascending: true })
      .limit(50)

    const withAnalytics = await Promise.all(
      (campaigns ?? []).map(async (c) => ({ ...c, analytics: await campaignAnalytics(c.id) })),
    )
    return NextResponse.json({ campaigns: withAnalytics })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load campaigns' }, { status: 500 })
  }
}
