import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { MemberCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { dobKey } from '@/lib/data/query'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/households/[id]/members — create a member with an encrypted DOB (RPC).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = MemberCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid member', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: memberId, error } = await db.rpc('member_create', {
      p_household_id: params.id,
      p_full_name: v.data.full_name,
      p_relationship: v.data.relationship ?? '',
      p_dob: v.data.dob ?? null,
      p_email: v.data.email ?? null,
      p_phone: v.data.phone ?? null,
      p_key: dobKey(),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'household_member',
      entityId: (memberId as string) ?? null,
      diff: { household_id: params.id, full_name: v.data.full_name, has_dob: Boolean(v.data.dob) },
    })
    return NextResponse.json({ member_id: memberId }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }
}
