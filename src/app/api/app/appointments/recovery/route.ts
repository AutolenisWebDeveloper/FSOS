import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { runNoShowRecovery } from '@/lib/appointments/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Revenue Command Center — No-show recovery (§13.4). Sweeps no-show appointments and
// creates one internal reschedule follow-up task per un-recovered no-show (deduplicated).
// Green-zone data assembly: it creates internal tasks only — no client is contacted here
// (any resulting outreach still flows through the workforce + the 7-step gate).

const RecoverySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = RecoverySchema.safeParse(parsed.data ?? {})
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  try {
    const actor = actorOf(auth.session)
    const result = await runNoShowRecovery(actor, { limit: v.data.limit })
    if ('error' in result) {
      return NextResponse.json({ error: 'Could not run no-show recovery', reason: result.error }, { status: 500 })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to run no-show recovery' }, { status: 500 })
  }
}
