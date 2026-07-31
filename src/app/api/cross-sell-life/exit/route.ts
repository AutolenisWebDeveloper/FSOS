import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { exitOnDownstream, scheduleFutureFollowUp, type DownstreamKind } from '@/lib/cross-sell-life/inbound'
import { CONTROL_ROLES } from '@/lib/cross-sell-life/controls'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Downstream campaign exits (§15/§27): a quote request, application start, policy issuance, or
// "purchased elsewhere" closes the member's open Cross-Sell Life enrollment; a future-follow-up
// pauses it out of the cadence with a return date. Called from the CRM quote/application/policy
// workflows and the AI/advisor conversation.
const Schema = z.object({
  householdId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
  kind: z.enum(['quote', 'application', 'policy', 'purchased_elsewhere', 'future_follow_up']),
  followUpDays: z.number().int().min(1).max(365).optional(),
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
    const actor = actorOf(auth.session)
    if (input.data.kind === 'future_follow_up') {
      const r = await scheduleFutureFollowUp({ householdId: input.data.householdId, memberId: input.data.memberId, days: input.data.followUpDays ?? 30, actor })
      return NextResponse.json(r, { status: r.ok ? 200 : 404 })
    }
    const r = await exitOnDownstream({ householdId: input.data.householdId, memberId: input.data.memberId, kind: input.data.kind as DownstreamKind, actor })
    return NextResponse.json(r, { status: r.exited ? 200 : 404 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Exit failed' }, { status: 500 })
  }
}
