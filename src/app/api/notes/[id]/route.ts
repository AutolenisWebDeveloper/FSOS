import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/*
 * A single Contact 360 note (redesign follow-up).
 * PATCH  — edit the body and/or toggle the pin/important flag.
 * DELETE — soft delete (sets deleted_at; the row is never hard-deleted).
 * FSA-gated; every mutation writes audit_log. Notes are internal free text, not
 * communications (no dispatcher path).
 */

const PatchSchema = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    is_pinned: z.boolean().optional(),
  })
  .refine((v) => v.body !== undefined || v.is_pinned !== undefined, { message: 'Nothing to update' })

const STAFF = ['fsa', 'licensed_staff', 'admin', 'super_admin'] as const

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...STAFF])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (v.data.body !== undefined) update.body = v.data.body
    if (v.data.is_pinned !== undefined) update.is_pinned = v.data.is_pinned

    const { data, error } = await db
      .from('notes')
      .update(update)
      .eq('id', id)
      .is('deleted_at', null)
      .select('id, household_id, member_id, author_id, body, is_pinned, created_at, updated_at')
      .maybeSingle()
    if (error) return dbErrorResponse('notes/[id]', error)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await writeAudit({ actor, action: 'entity.updated', entity: 'note', entityId: id, diff: { edited: v.data.body !== undefined, pinned: v.data.is_pinned } })
    return NextResponse.json({ note: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...STAFF])
  if (denied) return denied

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('notes')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()
    if (error) return dbErrorResponse('notes/[id]', error)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await writeAudit({ actor, action: 'entity.deleted', entity: 'note', entityId: id, diff: { soft: true } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
}
