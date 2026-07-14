import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, hasRole, actorOf } from '@/lib/auth/api'
import { MemberBaseSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { dobKey } from '@/lib/data/query'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/households/[id]/members/[mid]?dob=1 — member; DOB decrypt is role-gated
// (fsa/licensed_staff/super) and every decrypt is audited (rbac-matrix DOB rule).
export async function GET(req: NextRequest, { params }: { params: { id: string; mid: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data, error } = await db
      .from('household_members')
      .select('id, household_id, full_name, relationship, email, phone, created_at')
      .eq('id', params.mid)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let dob: string | null = null
    if (new URL(req.url).searchParams.get('dob') === '1' && hasRole(auth.session, 'fsa', 'licensed_staff', 'super_admin')) {
      const { data: d } = await db.rpc('member_dob', { p_id: params.mid, p_key: dobKey() })
      dob = (d as string | null) ?? null
      await writeAudit({ actor: actorOf(auth.session), action: 'entity.viewed', entity: 'household_member', entityId: params.mid, diff: { field: 'dob' } })
    }
    return NextResponse.json({ member: { ...data, dob } })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; mid: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = MemberBaseSchema.partial().safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  try {
    const db = getDb()
    const { error } = await db.rpc('member_update', {
      p_id: params.mid,
      p_full_name: v.data.full_name ?? null,
      p_relationship: v.data.relationship ?? '',
      p_dob: v.data.dob ?? null,
      p_email: v.data.email ?? null,
      p_phone: v.data.phone ?? null,
      p_key: dobKey(),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor: actorOf(auth.session), action: 'entity.updated', entity: 'household_member', entityId: params.mid, diff: { fields: Object.keys(v.data) } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
