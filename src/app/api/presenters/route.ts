import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { PresenterCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Presenters are REUSABLE across workshops (wholesaler / fund-family model). No securities
// data is stored. Roles: fsa/licensed_staff/admin (+super).

// GET /api/presenters — list for the authoring reuse picker.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied
  try {
    const db = getDb()
    const { data, error } = await db
      .from('presenters')
      .select('id, name, title, firm, presenter_type, fund_family, is_third_party, headshot_ref')
      .order('name', { ascending: true })
      .limit(500)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ presenters: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load presenters' }, { status: 500 })
  }
}

// POST /api/presenters — create a reusable presenter.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PresenterCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid presenter', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    // A wholesaler or fund-family presenter is inherently third-party.
    const isThirdParty = v.data.is_third_party || v.data.presenter_type === 'wholesaler' || !!v.data.fund_family
    const { data, error } = await db
      .from('presenters')
      .insert({
        name: v.data.name,
        title: v.data.title ?? null,
        firm: v.data.firm ?? null,
        presenter_type: v.data.presenter_type,
        fund_family: v.data.fund_family ?? null,
        is_third_party: isThirdParty,
        bio: v.data.bio ?? null,
        headshot_ref: v.data.headshot_ref ?? null,
      })
      .select('id')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'presenter',
      entityId: data.id,
      diff: { name: v.data.name, presenter_type: v.data.presenter_type, is_third_party: isThirdParty },
    })
    return NextResponse.json({ id: data.id, is_third_party: isThirdParty }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create presenter' }, { status: 500 })
  }
}
