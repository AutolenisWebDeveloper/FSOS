import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { AgencyCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/agencies — directory rows (FSA book). POST — create partnership.
// RBAC: view = fsa/licensed_staff/super; create = fsa/super (rbac-matrix Agency row).
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const url = new URL(req.url)
    const includeArchived = url.searchParams.get('archived') === '1'
    let q = getDb()
      .from('agency_partnerships')
      .select('*')
      .is('deleted_at', null)
      .order('ytd_placed_premium', { ascending: false })
    if (!includeArchived) q = q.is('archived_at', null)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ agencies: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load agencies' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = AgencyCreateSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid partnership', details: v.error.flatten() }, { status: 400 })
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // Non-blocking duplicate warning (spec OS-02 create acceptance).
    let warning: string | undefined
    if (v.data.owner_email) {
      const { data: dup } = await db
        .from('agency_owners')
        .select('id')
        .eq('email', v.data.owner_email)
        .limit(1)
      if (dup && dup.length) warning = 'An owner with this email already exists.'
    }

    const { data: agency, error } = await db
      .from('agency_partnerships')
      .insert({
        agency_name: v.data.agency_name,
        owner_name: v.data.owner_name,
        district_id: v.data.district_id ?? null,
        status: v.data.status,
        checkin_interval_days: v.data.checkin_interval_days,
        pc_book_policies: v.data.pc_book_policies,
        life_policies_in_force: v.data.life_policies_in_force,
        owner_scope: actor,
      })
      .select('*')
      .single()
    if (error || !agency) {
      return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    }

    // Owner contact record (holds email/phone, dedupe target).
    if (v.data.owner_email || v.data.owner_phone) {
      await db.from('agency_owners').insert({
        agency_id: agency.id,
        full_name: v.data.owner_name,
        email: v.data.owner_email ?? null,
        phone: v.data.owner_phone ?? null,
      })
    }

    // Automations (spec): seed activation at 'identified' + first check-in task.
    await db.from('agency_activation').insert({ agency_id: agency.id, stage: 'identified' })
    await db.from('work_tasks').insert({
      title: `Initial check-in: ${agency.agency_name}`,
      entity_type: 'agency_partnership',
      entity_id: agency.id,
      source: 'workflow',
      due_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      owner_scope: actor,
    })

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'agency_partnership',
      entityId: agency.id,
      diff: { agency_name: agency.agency_name, owner_name: agency.owner_name, status: agency.status },
    })

    return NextResponse.json({ agency, warning }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create partnership' }, { status: 500 })
  }
}
