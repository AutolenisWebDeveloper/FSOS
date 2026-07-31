import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { enrollOpportunity, removeEnrollment } from '@/lib/pipeline-winback/enroll'
import { CONTROL_ROLES } from '@/lib/pipeline-winback/controls'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const EnrollSchema = z.object({
  campaignId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  manualOverride: z.boolean().optional(),
})

const RemoveSchema = z.object({
  enrollmentId: z.string().uuid(),
  reason: z.string().trim().min(1).max(200),
})

// Manual enrollment (§5a) — staff/ops/admin may enroll a stalled opportunity directly;
// eligibility + shared suppression are still enforced (an override waives only the staleness
// floor and is audit-logged).
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', ...CONTROL_ROLES])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const input = EnrollSchema.safeParse(parsed.data)
  if (!input.success) return NextResponse.json({ error: 'Invalid input', details: input.error.flatten() }, { status: 400 })

  try {
    const result = await enrollOpportunity({ ...input.data, actor: actorOf(auth.session) })
    return NextResponse.json(result, { status: result.enrolled ? 201 : 409 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Enrollment failed' }, { status: 500 })
  }
}

// Manual removal (§5a) — an audited exit event.
export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', ...CONTROL_ROLES])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const input = RemoveSchema.safeParse(parsed.data)
  if (!input.success) return NextResponse.json({ error: 'Invalid input', details: input.error.flatten() }, { status: 400 })

  try {
    const result = await removeEnrollment({ ...input.data, actor: actorOf(auth.session) })
    return NextResponse.json(result)
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Removal failed' }, { status: 500 })
  }
}
