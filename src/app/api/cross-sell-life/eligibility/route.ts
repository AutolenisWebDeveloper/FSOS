import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'
import { loadCampaign, loadEligibilityInput, primaryMemberForHousehold } from '@/lib/cross-sell-life/data'
import { evaluateEligibility } from '@/lib/cross-sell-life/eligibility'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Eligibility explanation (§5) — evaluate a single (household, member) against a campaign and return
// the FULL reason set (never short-circuited), so an operator can see exactly why a client is or is
// not eligible before manually enrolling. Read-only; recomputes eligibility the SAME way the
// enrollment service and the per-touch tick do (§3).
const EligibilitySchema = z.object({
  campaignId: z.string().uuid(),
  householdId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const input = EligibilitySchema.safeParse(parsed.data)
  if (!input.success) return NextResponse.json({ error: 'Invalid input', details: input.error.flatten() }, { status: 400 })

  try {
    const campaign = await loadCampaign(input.data.campaignId)
    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    const memberId = input.data.memberId ?? (await primaryMemberForHousehold(input.data.householdId))?.id
    if (!memberId) return NextResponse.json({ error: 'No member found for household' }, { status: 404 })

    const nowISO = new Date().toISOString()
    const eligInput = await loadEligibilityInput(campaign, input.data.householdId, memberId, nowISO)
    const { eligible, reasons } = evaluateEligibility(eligInput)

    return NextResponse.json({
      eligible,
      reasons,
      householdId: input.data.householdId,
      memberId,
      input: eligInput,
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Eligibility check failed' }, { status: 500 })
  }
}
