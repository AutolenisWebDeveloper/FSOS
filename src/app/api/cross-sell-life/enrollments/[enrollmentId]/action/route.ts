import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { setEnrollmentPause, restartEnrollment, CONTROL_ROLES } from '@/lib/cross-sell-life/controls'
import { removeEnrollment } from '@/lib/cross-sell-life/enroll'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Single-enrollment management (§ Enrollment Management): pause / resume / restart-from-day-1 /
// remove. Restricted to staff/ops/admin/super/fsa; every action is audit-logged by the service.
const ActionSchema = z.object({
  action: z.enum(['pause', 'resume', 'restart', 'remove']),
  reason: z.string().trim().max(200).optional(),
})

export async function POST(req: NextRequest, props: { params: Promise<{ enrollmentId: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', ...CONTROL_ROLES])
  if (denied) return denied

  const { enrollmentId } = await props.params
  if (!z.string().uuid().safeParse(enrollmentId).success) return NextResponse.json({ error: 'Invalid enrollment id' }, { status: 400 })

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const input = ActionSchema.safeParse(parsed.data)
  if (!input.success) return NextResponse.json({ error: 'Invalid input', details: input.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    let result: { ok: boolean }
    switch (input.data.action) {
      case 'pause':
        result = await setEnrollmentPause({ enrollmentId, pause: true, actor, reason: input.data.reason })
        break
      case 'resume':
        result = await setEnrollmentPause({ enrollmentId, pause: false, actor, reason: input.data.reason })
        break
      case 'restart':
        result = await restartEnrollment({ enrollmentId, actor })
        break
      case 'remove':
        result = await removeEnrollment({ enrollmentId, actor, reason: input.data.reason ?? 'manual removal' })
        break
    }
    if (!result.ok) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 })
    return NextResponse.json(result)
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Enrollment action failed' }, { status: 500 })
  }
}
