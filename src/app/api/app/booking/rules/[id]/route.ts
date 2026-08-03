import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { AvailabilityRuleUpdate } from '@/lib/booking/config-schemas'
import { updateAvailabilityRule, deleteAvailabilityRule } from '@/lib/booking/config'
import { configErrorToResponse } from '@/lib/booking/route-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH /api/app/booking/rules/[id] — update a weekly availability window.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  // `acknowledge` rides alongside the rule fields (the Zod schema strips it); read it first.
  const acknowledge = (parsed.data as { acknowledge?: unknown } | null)?.acknowledge === true
  const v = AvailabilityRuleUpdate.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const res = await updateAvailabilityRule(actorOf(auth.session), id, v.data, { acknowledge })
    if (!res.ok) {
      if ('outside' in res) {
        return NextResponse.json(
          { error: res.message, reason: 'availability_conflict', appointmentsOutside: res.outside.length, appointments: res.outside },
          { status: 409 },
        )
      }
      return configErrorToResponse(res, 'update availability rule')
    }
    return NextResponse.json({ id: res.data.id })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update availability rule' }, { status: 500 })
  }
}

// DELETE /api/app/booking/rules/[id] — remove a weekly availability window.
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const acknowledge = new URL(req.url).searchParams.get('acknowledge') === 'true'

  try {
    const res = await deleteAvailabilityRule(actorOf(auth.session), id, { acknowledge })
    if (!res.ok) {
      if ('outside' in res) {
        return NextResponse.json(
          { error: res.message, reason: 'availability_conflict', appointmentsOutside: res.outside.length, appointments: res.outside },
          { status: 409 },
        )
      }
      return configErrorToResponse(res, 'delete availability rule')
    }
    return NextResponse.json({ id: res.data.id })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to delete availability rule' }, { status: 500 })
  }
}
