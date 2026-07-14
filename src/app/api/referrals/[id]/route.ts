import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PatchSchema = z
  .object({
    first_touch: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No changes')

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('referrals')
      .select('*')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ referral: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// PATCH — "log first touch" stops the SLA clock (status → working); archive toggle.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (v.data.first_touch) {
      update.first_touch_at = new Date().toISOString()
      update.status = 'working'
    }
    if (v.data.archived === true) update.archived_at = new Date().toISOString()
    if (v.data.archived === false) update.archived_at = null

    const { data, error } = await db
      .from('referrals')
      .update(update)
      .eq('id', params.id)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.updated',
      entity: 'referral',
      entityId: params.id,
      diff: v.data as Record<string, unknown>,
    })
    return NextResponse.json({ referral: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
