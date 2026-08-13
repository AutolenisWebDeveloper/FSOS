import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'
import { campaignAnalytics } from '@/lib/district-nurture/analytics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// District Agent FS Nurture ("The Second Conversation") — list campaigns with operational status
// + live analytics (ADR-038). Read-only; FSA portal.
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data: campaigns } = await db
      .from('district_nurture_campaigns')
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
