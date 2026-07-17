import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { POLICY_STATUS } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PatchSchema = z
  .object({
    status: z.enum(POLICY_STATUS).optional(),
    policy_number: z.string().trim().max(80).optional(),
    premium: z.coerce.number().min(0).optional(),
    renewal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    conversion_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No changes')

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('household_policies').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ policy: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'ops', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  try {
    const { archived, ...fields } = v.data
    const update: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() }
    if (archived === true) update.archived_at = new Date().toISOString()
    if (archived === false) update.archived_at = null
    const { data, error } = await getDb().from('household_policies').update(update).eq('id', params.id).is('deleted_at', null).select('*').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({ actor: actorOf(auth.session), action: 'entity.updated', entity: 'policy', entityId: params.id, diff: v.data as Record<string, unknown> })
    return NextResponse.json({ policy: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'super_admin'])
  if (denied) return denied
  try {
    const { data, error } = await getDb().from('household_policies').update({ deleted_at: new Date().toISOString() }).eq('id', params.id).is('deleted_at', null).select('id').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({ actor: actorOf(auth.session), action: 'entity.deleted', entity: 'policy', entityId: params.id })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
