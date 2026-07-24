import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Campaign + comms analytics. Per-campaign metrics come from v_campaign_metrics
// (DB-derived so the UI can't drift). Aggregate rates (delivery/open/click) are
// computed from those counts. Scope with ?campaign_id= for a single campaign.
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const campaignId = req.nextUrl.searchParams.get('campaign_id')?.trim() || ''

  try {
    const db = getDb()
    let builder = db.from('v_campaign_metrics').select('*')
    if (campaignId) builder = builder.eq('campaign_id', campaignId)
    const { data, error } = await builder
    if (error) return dbErrorResponse('comms/analytics', error)

    const rows = (data ?? []) as Array<{
      campaign_id: string
      name: string
      channel: string
      type: string
      messages: number
      sent: number
      delivered: number
      blocked: number
      failed: number
      opened: number
      clicked: number
    }>

    const withRates = rows.map((r) => ({
      ...r,
      delivery_rate: r.sent > 0 ? Math.round((r.delivered / r.sent) * 1000) / 10 : 0,
      open_rate: r.delivered > 0 ? Math.round((r.opened / r.delivered) * 1000) / 10 : 0,
      click_rate: r.opened > 0 ? Math.round((r.clicked / r.opened) * 1000) / 10 : 0,
    }))

    const totals = withRates.reduce(
      (acc, r) => {
        acc.messages += r.messages
        acc.sent += r.sent
        acc.delivered += r.delivered
        acc.blocked += r.blocked
        acc.failed += r.failed
        acc.opened += r.opened
        acc.clicked += r.clicked
        return acc
      },
      { messages: 0, sent: 0, delivered: 0, blocked: 0, failed: 0, opened: 0, clicked: 0 },
    )

    return NextResponse.json({ campaigns: withRates, totals })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
