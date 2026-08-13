import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { applyControl, CONTROL_ROLES } from '@/lib/district-nurture/controls'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ControlSchema = z.object({
  action: z.enum(['submit', 'enable', 'pause', 'resume', 'disable', 'emergency_stop', 'archive']),
  reason: z.string().trim().max(300).optional(),
  resumeBehavior: z.enum(['all_active', 'only_admin_paused', 'restart_day_1', 'only_new']).optional(),
  replayPolicy: z.enum(['skip', 'replay']).optional(),
})

// Operational controls (ADR-038 §5a): enable / pause / resume / disable / emergency-stop / archive.
// Restricted to ops/admin/super/fsa via RBAC role-intersection; every action is audit-logged with
// prev→next + reason. Only an Active campaign dispatches, so a global stop halts every touch + the
// enrollment sweep in one place.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, CONTROL_ROLES)
  if (denied) return denied

  const { id } = await props.params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const input = ControlSchema.safeParse(parsed.data)
  if (!input.success) return NextResponse.json({ error: 'Invalid input', details: input.error.flatten() }, { status: 400 })

  try {
    const result = await applyControl({
      campaignId: id,
      action: input.data.action,
      reason: input.data.reason,
      resumeBehavior: input.data.resumeBehavior,
      replayPolicy: input.data.replayPolicy,
      actor: actorOf(auth.session),
    })
    if (!result.ok) return NextResponse.json(result, { status: result.error === 'campaign_missing' ? 404 : 409 })
    return NextResponse.json(result)
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Control action failed' }, { status: 500 })
  }
}
