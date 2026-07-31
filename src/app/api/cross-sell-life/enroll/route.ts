import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { enrollContact, removeEnrollment } from '@/lib/cross-sell-life/enroll'
import { CONTROL_ROLES } from '@/lib/cross-sell-life/controls'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Manual enrollment (§5) — staff/ops/admin may enroll a single household or a bulk set directly;
// eligibility + population separation are still enforced per household (a forceOverride waives only
// the soft cooldown and is audit-logged). Nothing SENDS here — sends happen in the tick, gated.
const SingleSchema = z.object({
  campaignId: z.string().uuid(),
  householdId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
  forceOverride: z.boolean().optional(),
})

const BulkSchema = z.object({
  campaignId: z.string().uuid(),
  householdIds: z.array(z.string().uuid()).min(1).max(500),
  forceOverride: z.boolean().optional(),
})

const EnrollSchema = z.union([BulkSchema, SingleSchema])

const RemoveSchema = z.object({
  enrollmentId: z.string().uuid(),
  reason: z.string().trim().min(1).max(200),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', ...CONTROL_ROLES])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const input = EnrollSchema.safeParse(parsed.data)
  if (!input.success) return NextResponse.json({ error: 'Invalid input', details: input.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    // Bulk path — one enrollContact call per household; per-household eligibility is still enforced.
    if ('householdIds' in input.data) {
      const { campaignId, householdIds, forceOverride } = input.data
      const results = await Promise.all(
        householdIds.map(async (householdId) => ({
          householdId,
          ...(await enrollContact({ campaignId, householdId, forceOverride, actor })),
        })),
      )
      const enrolled = results.filter((r) => r.enrolled).length
      return NextResponse.json({ enrolled, results })
    }

    // Single path.
    const { campaignId, householdId, memberId, forceOverride } = input.data
    const result = await enrollContact({ campaignId, householdId, memberId, forceOverride, actor })
    return NextResponse.json(result, { status: result.enrolled ? 201 : 409 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Enrollment failed' }, { status: 500 })
  }
}

// Manual removal (§5) — an audited exit event.
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
