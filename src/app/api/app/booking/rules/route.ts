import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { AvailabilityRuleCreate } from '@/lib/booking/config-schemas'
import { listAvailabilityRules, createAvailabilityRule } from '@/lib/booking/config'
import { configErrorToResponse } from '@/lib/booking/route-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/app/booking/rules — list weekly availability rules.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const res = await listAvailabilityRules()
    if (!res.ok) return configErrorToResponse(res, 'list availability rules')
    return NextResponse.json({ rules: res.data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load availability rules' }, { status: 500 })
  }
}

// POST /api/app/booking/rules — add a weekly availability window.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = AvailabilityRuleCreate.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid availability rule', details: v.error.flatten() }, { status: 400 })

  try {
    const res = await createAvailabilityRule(actorOf(auth.session), v.data)
    if (!res.ok) return configErrorToResponse(res, 'create availability rule')
    return NextResponse.json({ id: res.data.id }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create availability rule' }, { status: 500 })
  }
}
