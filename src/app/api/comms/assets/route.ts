import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'
import { listSendableAssets, campaignLabel } from '@/lib/comms/assets'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Communications Command Console (spec §B2/§4) — the cross-campaign sendable-asset catalog
// that powers the console's "from a campaign" picker. Pure READ over the read-only
// comm_sendable_assets view (mig 087). Filters by channel / campaign / free-text search.
// Every campaign learns the picker about itself by adding one union all to the view.
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const channelParam = url.searchParams.get('channel')
  const channel = channelParam === 'sms' || channelParam === 'email' ? channelParam : null
  const campaign = url.searchParams.get('campaign')
  const q = url.searchParams.get('q')

  try {
    const rows = await listSendableAssets({ channel, campaign, q })
    // Group by campaign so the picker can render campaign sections (spec §5).
    const groups: Record<string, { key: string; label: string; assets: typeof rows }> = {}
    for (const r of rows) {
      const key = r.campaign_key ?? '__library'
      if (!groups[key]) groups[key] = { key, label: campaignLabel(r.campaign_key), assets: [] }
      groups[key].assets.push(r)
    }
    return NextResponse.json({ assets: rows, groups: Object.values(groups), count: rows.length })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load assets' }, { status: 500 })
  }
}
