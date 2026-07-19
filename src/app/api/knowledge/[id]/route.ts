import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { KnowledgePatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Knowledge Library — read / update / archive a single document.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const { id } = await props.params
  try {
    const { data, error } = await getDb().from('knowledge_documents').select('*').eq('id', id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ document: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = KnowledgePatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('knowledge_documents')
      .update({ ...v.data, updated_by: actor, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, title, kind, status, is_assumption, visibility, updated_at')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({ actor, action: 'entity.updated', entity: 'knowledge_document', entityId: id, diff: v.data })
    return NextResponse.json({ document: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    // Soft archive rather than hard delete (retain provenance/citations).
    const { data, error } = await db
      .from('knowledge_documents')
      .update({ status: 'archived', updated_by: actor, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({ actor, action: 'entity.deleted', entity: 'knowledge_document', entityId: id, diff: { archived: true } })
    return NextResponse.json({ ok: true, archived: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
