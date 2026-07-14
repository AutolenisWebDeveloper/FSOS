import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { ReferralRejectSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/referrals/[id]/reject — status → declined with a config loss reason.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ReferralRejectSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid rejection', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const { data, error } = await db
      .from('referrals')
      .update({ status: 'declined', loss_reason: v.data.loss_reason, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .is('deleted_at', null)
      .neq('status', 'converted')
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found or already converted' }, { status: 404 })

    if (v.data.note) {
      await db.from('activities').insert({
        entity_type: 'referral',
        entity_id: params.id,
        kind: 'reject_note',
        note: v.data.note,
        actor: actorOf(auth.session),
      })
    }
    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.updated',
      entity: 'referral',
      entityId: params.id,
      diff: { status: 'declined', loss_reason: v.data.loss_reason },
    })
    return NextResponse.json({ referral: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
