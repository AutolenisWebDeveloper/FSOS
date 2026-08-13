import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { HouseholdPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('households').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle()
    if (error) return dbErrorResponse('households/[id]', error)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ household: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = HouseholdPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  try {
    const { archived, ...fields } = v.data
    const update: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() }
    if (archived === true) update.archived_at = new Date().toISOString()
    if (archived === false) update.archived_at = null
    const { data, error } = await getDb().from('households').update(update).eq('id', params.id).is('deleted_at', null).select('*').maybeSingle()
    if (error) return dbErrorResponse('households/[id]', error)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({ actor: actorOf(auth.session), action: 'entity.updated', entity: 'household', entityId: params.id, diff: v.data as Record<string, unknown> })
    return NextResponse.json({ household: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Remove a household. Default is a SOFT delete (sets deleted_at — recoverable in DB).
// `?mode=purge` PERMANENTLY hard-deletes the aggregate: the cascade removes members,
// policies, reviews, FNA plans, notes, consents, and campaign enrollments, while
// appointments / cases / opportunities / referrals detach (ON DELETE SET NULL). Both
// paths are narrowed to fsa + super_admin.
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'super_admin'])
  if (denied) return denied
  const purge = req.nextUrl.searchParams.get('mode') === 'purge'
  try {
    const db = getDb()
    if (purge) {
      const { data: existing } = await db.from('households').select('id').eq('id', params.id).is('deleted_at', null).maybeSingle()
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const { error } = await db.from('households').delete().eq('id', params.id)
      if (error) return dbErrorResponse('households/[id]', error)
      await writeAudit({ actor: actorOf(auth.session), action: 'entity.deleted', entity: 'household', entityId: params.id, diff: { mode: 'purge' } })
      return NextResponse.json({ ok: true, purged: true })
    }
    const { data, error } = await db.from('households').update({ deleted_at: new Date().toISOString() }).eq('id', params.id).is('deleted_at', null).select('id').maybeSingle()
    if (error) return dbErrorResponse('households/[id]', error)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({ actor: actorOf(auth.session), action: 'entity.deleted', entity: 'household', entityId: params.id, diff: { mode: 'soft' } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
