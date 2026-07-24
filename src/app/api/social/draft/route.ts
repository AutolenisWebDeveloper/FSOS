import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { GatewayDisabledError } from '@/lib/ai/gateway'
import { DraftRequestSchema } from '@/lib/social/schema'
import { draftContent } from '@/lib/social/drafter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Content Drafter — produces DRAFT variants for human review. It never creates,
// approves, or publishes content; the FSA saves/edits/approves through the content
// routes. Governance (kill switch, agent_runs, Zod validation, red-line screening)
// is enforced inside draftContent().
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = DraftRequestSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid draft request', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const res = await draftContent(v.data, actor)
    // Even a failed draft returns 200 with needsReview — it's an assist, not a write.
    return NextResponse.json(
      { ok: res.ok, variants: res.output?.variants ?? [], needsReview: res.needsReview, flags: res.flags, confidence: res.output?.confidence ?? null, message: res.message },
      { status: 200 },
    )
  } catch (e) {
    if (e instanceof GatewayDisabledError) {
      return NextResponse.json({ error: 'AI drafting is disabled by the kill switch.', code: 'kill_switch' }, { status: 503 })
    }
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to draft content' }, { status: 500 })
  }
}
