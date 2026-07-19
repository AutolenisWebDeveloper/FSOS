import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth } from '@/lib/http'
import { ghlSummary } from '@/lib/ghl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/agencies/list — internal
// Agency Owners page live data — each agency enriched with referral stats.
// Ordered by last_referral DESC NULLS LAST.
export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized
  try {
    const db = getDb()

    const { data: agencies, error } = await db
      .from('agencies')
      .select('*')
      .order('last_referral', { ascending: false, nullsFirst: false })

    if (error) {
      console.error('[agencies/list] query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Pull all referrals once and aggregate per agency in memory
    const { data: referrals } = await db
      .from('agency_referrals')
      .select('agency_id, status, submitted_at')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byAgency = new Map<string, { count: number; pending: number; last: string | null }>()
    for (const r of (referrals || []) as Array<{ agency_id: string; status: string; submitted_at: string }>) {
      const cur = byAgency.get(r.agency_id) || { count: 0, pending: 0, last: null }
      cur.count += 1
      if (r.status === 'new') cur.pending += 1
      if (!cur.last || (r.submitted_at && r.submitted_at > cur.last)) cur.last = r.submitted_at
      byAgency.set(r.agency_id, cur)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enriched = ((agencies || []) as any[]).map((a) => {
      const stats = byAgency.get(a.agency_id) || { count: 0, pending: 0, last: null }
      const lastReferral = stats.last ?? a.last_referral ?? null
      const daysSince = lastReferral
        ? Math.floor((Date.now() - new Date(lastReferral).getTime()) / 86400000)
        : 999
      return {
        ...a,
        referral_count: stats.count,
        pending_referrals: stats.pending,
        last_referral: lastReferral,
        days_since_referral: daysSince,
        needs_attention: lastReferral ? daysSince > 30 : stats.pending > 0,
        ghl: ghlSummary(a),
      }
    })

    return NextResponse.json({ agencies: enriched })
  } catch (err) {
    console.error('[agencies/list] unexpected error:', err)
    return NextResponse.json({ error: 'Failed to load agencies' }, { status: 500 })
  }
}
