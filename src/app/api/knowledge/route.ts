import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, parseLimit } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { KnowledgeCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { searchKnowledge } from '@/lib/knowledge/library'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Knowledge Library — list/search + create. GET ?q= runs full-text retrieval
// (the same path the AI responder uses); without q it lists recent docs. Farmers-
// specific facts are stored with is_assumption=true and surfaced with a
// "config default — verify" badge; they are never asserted by the AI as fact.
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const q = req.nextUrl.searchParams.get('q')?.trim() || ''
  const kind = req.nextUrl.searchParams.get('kind')?.trim() || ''
  const limit = parseLimit(req.nextUrl.searchParams.get('limit'), 50, 100)

  try {
    if (q) {
      const chunks = await searchKnowledge(q, { limit })
      return NextResponse.json({ documents: chunks, query: q })
    }
    let builder = getDb()
      .from('knowledge_documents')
      .select('id, title, kind, category, summary, tags, status, is_assumption, visibility, usage_count, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (kind) builder = builder.eq('kind', kind)
    const { data, error } = await builder
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ documents: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = KnowledgeCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid document', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('knowledge_documents')
      .insert({ ...v.data, created_by: actor, updated_by: actor })
      .select('id, title, kind, category, status, is_assumption, visibility, updated_at')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'knowledge_document', entityId: data.id, diff: { title: data.title, kind: data.kind } })
    return NextResponse.json({ document: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
  }
}
