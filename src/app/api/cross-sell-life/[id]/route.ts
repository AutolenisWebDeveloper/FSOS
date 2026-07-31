import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'
import { loadCampaignDetail } from '@/lib/cross-sell-life/detail'
import { campaignAnalytics } from '@/lib/cross-sell-life/analytics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Full campaign management view (§ Management Interface): configuration + 35-touch schedule +
// playbooks/advisor scripts + version history, alongside live analytics. Read-only; FSA portal.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const { id } = await props.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  try {
    const detail = await loadCampaignDetail(id)
    if (!detail) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    const analytics = await campaignAnalytics(id)
    return NextResponse.json({ ...detail, analytics })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load campaign' }, { status: 500 })
  }
}
