import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { originateCrossSellOpportunities } from '@/lib/opportunities/originate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Revenue Command Center — Cross-Sell origination (§13.1). Turns detected coverage
// gaps (v_cross_sell_gaps) into tracked, attributed, deduplicated cross-sell
// opportunities. Green-zone data assembly: it creates internal pipeline records only —
// no client is contacted here (outreach still flows through the workforce + gate).
// Firewall + dedup are enforced in the pure planner; is_security is always false.

const OriginateSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  // Body is optional — an empty POST originates with the default limit.
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = OriginateSchema.safeParse(parsed.data ?? {})
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  try {
    const actor = actorOf(auth.session)
    const result = await originateCrossSellOpportunities(actor, { limit: v.data.limit })
    if ('error' in result) {
      return NextResponse.json({ error: 'Could not originate cross-sell opportunities', reason: result.error }, { status: 500 })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to originate cross-sell opportunities' }, { status: 500 })
  }
}
