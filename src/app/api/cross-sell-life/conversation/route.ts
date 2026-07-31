import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { applyInboundIntent } from '@/lib/cross-sell-life/inbound'
import { loadActiveCampaign } from '@/lib/cross-sell-life/data'
import { INTENT_LIBRARY } from '@/lib/cross-sell-life/conversation'
import { CONTROL_ROLES } from '@/lib/cross-sell-life/controls'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Apply a classified inbound intent to a member's open Cross-Sell Life enrollment (§13/§14): map a
// terminal intent to the §15 exit, escalate an advisor-sensitive/low-confidence intent, or keep the
// conversation open. The confidence threshold comes from the active campaign config.
const Schema = z.object({
  householdId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
  intent: z.enum(INTENT_LIBRARY as unknown as [string, ...string[]]),
  confidence: z.number().min(0).max(1),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', ...CONTROL_ROLES])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const input = Schema.safeParse(parsed.data)
  if (!input.success) return NextResponse.json({ error: 'Invalid input', details: input.error.flatten() }, { status: 400 })

  try {
    const campaign = await loadActiveCampaign()
    const threshold = campaign?.intent_confidence_threshold ?? 0.6
    const result = await applyInboundIntent({
      householdId: input.data.householdId,
      memberId: input.data.memberId,
      intent: input.data.intent as never,
      confidence: input.data.confidence,
      threshold,
      actor: actorOf(auth.session),
    })
    return NextResponse.json(result, { status: result.handled ? 200 : 404 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Intent handling failed' }, { status: 500 })
  }
}
