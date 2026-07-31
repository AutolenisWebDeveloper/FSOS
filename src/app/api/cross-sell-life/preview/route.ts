import { NextRequest, NextResponse } from 'next/server'
import { parseLimit, configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'
import { listGapHouseholds, loadActiveCampaign, loadEligibilityInput, primaryMemberForHousehold } from '@/lib/cross-sell-life/data'
import { evaluateEligibility } from '@/lib/cross-sell-life/eligibility'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Enrollment-queue preview / dry-run (§5) — the highest-scoring gap households (existing non-life
// clients with a coverage gap) with a lightweight eligibility snapshot computed the SAME way the
// daily enrollment sweep does, so an operator can see who would enroll before activating. Read-only.
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const limit = parseLimit(req.nextUrl.searchParams.get('limit'), 50, 200)

  try {
    const campaign = await loadActiveCampaign()
    if (!campaign) return NextResponse.json({ campaign: null, households: [], note: 'No live campaign version to preview against.' })

    const gaps = await listGapHouseholds(limit)
    const nowISO = new Date().toISOString()

    const households = await Promise.all(
      gaps.map(async (gap) => {
        const member = await primaryMemberForHousehold(gap.household_id)
        if (!member) {
          return { ...gap, member_id: null, eligible: false, reasons: ['no_member'] as string[] }
        }
        const eligInput = await loadEligibilityInput(campaign, gap.household_id, member.id, nowISO)
        const { eligible, reasons } = evaluateEligibility(eligInput)
        return { ...gap, member_id: member.id, eligible, reasons }
      }),
    )

    return NextResponse.json({
      campaign: { id: campaign.id, version: campaign.version, status: campaign.status, daily_enrollment_limit: campaign.daily_enrollment_limit },
      count: households.length,
      eligibleCount: households.filter((h) => h.eligible).length,
      households,
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load preview' }, { status: 500 })
  }
}
