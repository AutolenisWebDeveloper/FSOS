import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, readJson } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { GatewayDisabledError } from '@/lib/ai/gateway'
import { ComplianceUploadPatchSchema } from '@/lib/validation/schemas'
import { PARSER_VERSION, summarizeStructuredReport } from '@/lib/compliance/extract'
import { PIPELINE_MODEL, structureRightBridge } from '@/lib/compliance/pipeline'
import { COMPLIANCE_BUCKET, runExtractionForUpload, signedUrlFor } from '@/lib/compliance/uploads'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — single upload record (mig 037).
// GET  ?q=       → upload detail + per-page text (with optional search-within-doc)
// PATCH { kind?, case_id?, action? }
//        action=reprocess → re-download + re-extract (retry path)
//        action=structure → build the version-aware structured RightBridge report
//        action=classify  → (no-op placeholder; kind is set directly via `kind`)
// DELETE          → remove the stored object + record (audited)
// Original files are immutable; only classification/links/derived content change.

const WRITE_ROLES = ['fsa', 'licensed_staff', 'super_admin'] as const

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const q = (req.nextUrl.searchParams.get('q') || '').trim()

  try {
    const db = getDb()
    const { data: upload, error } = await db
      .from('compliance_uploads')
      .select(
        'id, case_id, kind, filename, content_type, size_bytes, sha256, status, extraction_method, page_count, char_count, extraction_confidence, low_confidence, error, report_id, storage_path, parser_version, model_version, uploaded_at, processed_at, created_at',
      )
      .eq('id', params.id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

    let pagesBuilder = db
      .from('compliance_upload_pages')
      .select('page_number, text, char_count, low_confidence')
      .eq('upload_id', params.id)
      .order('page_number', { ascending: true })
    // Search-within-document over the page FTS vector.
    if (q) pagesBuilder = pagesBuilder.textSearch('search_tsv', q, { type: 'websearch', config: 'english' })
    const { data: pages } = await pagesBuilder

    const url = await signedUrlFor(db, upload.storage_path)
    const { storage_path: _omit, ...rest } = upload as Record<string, unknown>
    void _omit
    return NextResponse.json({ upload: { ...rest, url }, pages: pages ?? [], query: q || null })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load upload' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req, 20_000)
  if ('error' in parsed) return parsed.error
  const v = ComplianceUploadPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })
  const d = v.data

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: upload } = await db
      .from('compliance_uploads')
      .select('id, case_id, kind, filename, content_type, storage_path, status')
      .eq('id', params.id)
      .maybeSingle()
    if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

    // Simple field updates (kind / case link).
    const patch: Record<string, unknown> = {}
    if (d.kind) patch.kind = d.kind
    if (d.case_id !== undefined) patch.case_id = d.case_id
    if (Object.keys(patch).length) {
      await db.from('compliance_uploads').update(patch).eq('id', params.id)
      await writeAudit({ actor, action: 'entity.updated', entity: 'compliance_upload', entityId: params.id, diff: patch })
    }

    // action=reprocess → re-download the original bytes and re-run extraction.
    if (d.action === 'reprocess') {
      const { data: blob, error: dlErr } = await db.storage.from(COMPLIANCE_BUCKET).download(upload.storage_path)
      if (dlErr || !blob) return NextResponse.json({ error: 'Could not read the stored file to reprocess.' }, { status: 502 })
      const buffer = Buffer.from(await blob.arrayBuffer())
      const result = await runExtractionForUpload(
        db,
        { id: upload.id, filename: upload.filename, content_type: upload.content_type, kind: d.kind ?? upload.kind },
        buffer,
      )
      await writeAudit({ actor, action: 'ai.action', entity: 'compliance_upload', entityId: params.id, diff: { reprocess: true, status: result.status } })
      return NextResponse.json({ upload_id: params.id, ...result })
    }

    // action=structure → build the structured RightBridge report from page text.
    if (d.action === 'structure') {
      await db.from('compliance_uploads').update({ status: 'structuring' }).eq('id', params.id)
      const { data: pages } = await db
        .from('compliance_upload_pages')
        .select('page_number, text')
        .eq('upload_id', params.id)
        .order('page_number', { ascending: true })
      if (!pages || pages.length === 0) {
        await db.from('compliance_uploads').update({ status: 'needs_review', error: 'No extracted text to structure.' }).eq('id', params.id)
        return NextResponse.json({ error: 'No extracted text to structure. Reprocess the upload first.' }, { status: 409 })
      }

      const structured = await structureRightBridge(pages as { page_number: number; text: string }[])
      if (!structured) {
        await db.from('compliance_uploads').update({ status: 'extracted' }).eq('id', params.id)
        return NextResponse.json({ error: 'Could not structure this report from the extracted text.' }, { status: 502 })
      }

      const { data: rpt, error: rptErr } = await db
        .from('rightbridge_reports')
        .insert({
          case_id: upload.case_id ?? null,
          report_type: 'product_profiler',
          title: upload.filename,
          structured_report: structured,
          raw_text: pages.map((p) => p.text).join('\n\n').slice(0, 200_000),
          source: 'upload',
          upload_id: params.id,
          file_ref: upload.storage_path,
          parser_version: PARSER_VERSION,
          model_version: PIPELINE_MODEL,
          created_by: actor,
        })
        .select('id')
        .single()
      if (rptErr || !rpt) return NextResponse.json({ error: rptErr?.message ?? 'Failed to save structured report' }, { status: 500 })

      await db.from('compliance_uploads').update({ status: 'analyzed', report_id: rpt.id }).eq('id', params.id)
      await writeAudit({ actor, action: 'ai.action', entity: 'rightbridge_report', entityId: rpt.id, diff: { from_upload: params.id, ...summarizeStructuredReport(structured) } })
      return NextResponse.json({ report_id: rpt.id, structured, summary: summarizeStructuredReport(structured) })
    }

    return NextResponse.json({ ok: true, updated: Object.keys(patch) })
  } catch (e) {
    if (e instanceof GatewayDisabledError) {
      return NextResponse.json({ error: e.message, code: 'ai_disabled' }, { status: 503 })
    }
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: upload } = await db
      .from('compliance_uploads')
      .select('id, storage_path, filename')
      .eq('id', params.id)
      .maybeSingle()
    if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

    // Remove the stored object (best-effort) then the record (pages cascade).
    await db.storage.from(COMPLIANCE_BUCKET).remove([upload.storage_path]).catch(() => {})
    const { error } = await db.from('compliance_uploads').delete().eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({ actor, action: 'entity.deleted', entity: 'compliance_upload', entityId: params.id, diff: { filename: upload.filename } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
