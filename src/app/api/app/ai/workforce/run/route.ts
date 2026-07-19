import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST — run the AI workforce NOW (on-demand, in addition to the daily cron). FSA/
// super only. Builds today's queue and dispatches every enabled outreach agent up to
// its quota, all through the compliance gate. Kill switches still apply — a disabled
// agent or global gateway contributes zero sends. Idempotent within the day.
export async function POST(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'super_admin'])
  if (denied) return denied

  try {
    const { runWorkforce } = await import('@/lib/ai/workforce')
    const result = await runWorkforce()
    await writeAudit({
      actor: actorOf(auth.session),
      action: 'ai.run',
      entity: 'workforce',
      diff: { trigger: 'manual', totalSent: result.totalSent, dispatch: result.dispatch },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
