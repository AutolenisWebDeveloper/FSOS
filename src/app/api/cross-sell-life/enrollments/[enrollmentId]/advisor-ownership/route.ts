import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { advisorTakeOwnership } from '@/lib/cross-sell-life/inbound'
import { CONTROL_ROLES } from '@/lib/cross-sell-life/controls'
import { resolveAdvisorOwner } from '@/lib/cross-sell-life/ownership-core'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// An advisor accepts ownership of an escalated Cross-Sell Life conversation (§14): the enrollment
// moves to advisor_owned and the AI stops proactive replies until ownership is released. The owner
// is the AUTHENTICATED operator (D7) — `advisor` is optional and, if supplied, must be the caller
// themselves; we never write an unvalidated/arbitrary UUID that could stall automation.
const Schema = z.object({ advisor: z.string().uuid().optional() })

export async function POST(req: NextRequest, props: { params: Promise<{ enrollmentId: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', ...CONTROL_ROLES])
  if (denied) return denied

  const { enrollmentId } = await props.params
  if (!z.string().uuid().safeParse(enrollmentId).success) return NextResponse.json({ error: 'Invalid enrollment id' }, { status: 400 })

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const input = Schema.safeParse(parsed.data)
  if (!input.success) return NextResponse.json({ error: 'Invalid input', details: input.error.flatten() }, { status: 400 })

  // Owner = the authenticated operator; reject a body advisor that is not the caller (D7).
  const owner = resolveAdvisorOwner(actorOf(auth.session), input.data.advisor)
  if (!owner.ok) return NextResponse.json({ error: 'Invalid advisor', reason: owner.error }, { status: 400 })

  try {
    const result = await advisorTakeOwnership({ enrollmentId, advisor: owner.advisor, actor: actorOf(auth.session) })
    return NextResponse.json(result, { status: result.ok ? 200 : 404 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Ownership assignment failed' }, { status: 500 })
  }
}
