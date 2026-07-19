import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, readJson, parseLimit } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ComplianceIngestSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — Knowledge Library ingestion (blueprint §2, Prompt 2).
// POST: store a governing document + chunk it (~2k chars, 200 overlap) + tier-tag
// every chunk with the parent authority_type for retrieval. GET: list the library
// grouped by authority_type so the UI can show which tiers are populated vs. the
// FFS_PROCEDURE / CARRIER_REQUIREMENT stubs the FSA still needs to upload.

const WRITE_ROLES = ['fsa', 'licensed_staff', 'super_admin'] as const

/** Character-window chunker with overlap, preferring paragraph boundaries. */
function chunkText(text: string, size = 2000, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (clean.length <= size) return clean ? [clean] : []
  const chunks: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length)
    if (end < clean.length) {
      // Prefer a paragraph/sentence break within the trailing 25% of the window.
      const slice = clean.slice(start, end)
      const para = slice.lastIndexOf('\n\n')
      const sent = slice.lastIndexOf('. ')
      const brk = para > size * 0.5 ? para : sent > size * 0.5 ? sent + 1 : -1
      if (brk > 0) end = start + brk
    }
    chunks.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks.filter(Boolean)
}

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const limit = parseLimit(req.nextUrl.searchParams.get('limit'), 200, 500)

  try {
    const db = getDb()
    const { data: docs, error } = await db
      .from('compliance_documents')
      .select('id, title, authority_type, source_org, section_ref, carrier, product_scope, state_scope, verbatim, is_assumption, source, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Chunk counts per tier so the UI can surface populated vs. empty tiers.
    const { data: chunkRows } = await db.from('compliance_chunks').select('authority_type')
    const byTier: Record<string, number> = {}
    for (const r of (chunkRows ?? []) as { authority_type: string }[]) {
      byTier[r.authority_type] = (byTier[r.authority_type] ?? 0) + 1
    }
    return NextResponse.json({ documents: docs ?? [], chunk_counts_by_tier: byTier })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req, 2_000_000) // governing docs can be large
  if ('error' in parsed) return parsed.error
  const v = ComplianceIngestSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid document', details: v.error.flatten() }, { status: 400 })
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const d = v.data

    const { data: doc, error: docErr } = await db
      .from('compliance_documents')
      .insert({
        title: d.title,
        authority_type: d.authority_type,
        source_org: d.source_org ?? null,
        section_ref: d.section_ref ?? null,
        effective_date: d.effective_date ?? null,
        product_scope: d.product_scope,
        state_scope: d.state_scope,
        carrier: d.carrier ?? null,
        is_assumption: d.is_assumption,
        verbatim: d.verbatim,
        source: 'upload',
        created_by: actor,
        updated_by: actor,
      })
      .select('id')
      .single()
    if (docErr || !doc) {
      return NextResponse.json({ error: docErr?.message ?? 'Insert failed' }, { status: 500 })
    }

    const pieces = chunkText(d.text)
    const rows = pieces.map((chunk_text, i) => ({
      document_id: doc.id,
      seq: i,
      authority_type: d.authority_type,
      section_ref: d.section_ref ?? null,
      title: d.title,
      chunk_text,
      product_scope: d.product_scope,
      state_scope: d.state_scope,
      verbatim: d.verbatim,
    }))
    if (rows.length) {
      const { error: chunkErr } = await db.from('compliance_chunks').insert(rows)
      if (chunkErr) return NextResponse.json({ error: chunkErr.message }, { status: 500 })
    }

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'compliance_document',
      entityId: doc.id,
      diff: { title: d.title, authority_type: d.authority_type, chunks: rows.length },
    })
    return NextResponse.json({ document_id: doc.id, chunks: rows.length }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to ingest document' }, { status: 500 })
  }
}
