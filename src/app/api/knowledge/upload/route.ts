import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { sha256Hex } from '@/lib/compliance/extract'
import { KnowledgeUploadMetaSchema } from '@/lib/validation/schemas'
import {
  buildKnowledgeStoragePath,
  extractForKnowledge,
  findDuplicateUpload,
  rejectUpload,
  SUPPORTED_UPLOAD_HINT,
  deriveTitleFromFilename,
} from '@/lib/knowledge/uploads'
import { createSignedUrl, PRIVATE_DOCUMENTS_BUCKET, removeObjects } from '@/lib/storage/private-documents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Knowledge Library — upload the ACTUAL FILE behind a knowledge document.
//
// POST multipart { file, title?, kind?, category?, summary?, tags?, status?,
//                  visibility?, is_assumption?, force? }:
//   validate → hash (dedup) → secure the original to the private `documents` bucket
//   → extract page text (native PDF → model-vision OCR fallback) → create the
//   knowledge_documents row with the extracted text as `content` so the existing
//   full-text retrieval finds it → return a short-lived signed URL for download.
//
// The stored path is never returned to the browser (signed URL only), and a failed
// extraction still yields a usable document: the original is preserved, the row is
// flagged low-confidence, and the FSA can paste the text in by editing it.

const WRITE_ROLES = ['fsa', 'licensed_staff', 'admin', 'super_admin'] as const

/** Server-side diagnostic log (§16.2). Never carries file bytes or a signed URL. */
function logUploadFailure(event: string, detail: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(`[api] knowledge/upload ${event}`, detail)
}

/** Read a boolean-ish multipart value ('on' from a checkbox, '1'/'true' from JS). */
function formBool(v: FormDataEntryValue | null): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase())
}

/** Optional trimmed string from a multipart field; undefined when blank. */
function formText(v: FormDataEntryValue | null): string | undefined {
  const s = String(v ?? '').trim()
  return s === '' ? undefined : s
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a file.' }, { status: 400 })
  }

  const file = formData.get('file')
  const candidate = file instanceof File ? { name: file.name, size: file.size } : null
  const rejection = rejectUpload(candidate)
  if (rejection || !(file instanceof File)) {
    const r = rejection ?? { code: 'empty' as const, status: 400, message: 'Choose a non-empty file to upload.' }
    return NextResponse.json({ error: r.message, code: r.code, hint: SUPPORTED_UPLOAD_HINT }, { status: r.status })
  }

  // Validate the accompanying metadata with the same bounds as the manual form.
  const meta = KnowledgeUploadMetaSchema.safeParse({
    title: formText(formData.get('title')),
    kind: formText(formData.get('kind')) ?? 'document',
    category: formText(formData.get('category')),
    summary: formText(formData.get('summary')),
    tags: String(formData.get('tags') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    status: formText(formData.get('status')) ?? 'published',
    visibility: formText(formData.get('visibility')) ?? 'internal',
    is_assumption: formBool(formData.get('is_assumption')),
    force: formBool(formData.get('force')),
  })
  if (!meta.success) {
    return NextResponse.json(
      { error: 'Invalid document details', details: meta.error.flatten() },
      { status: 400 },
    )
  }
  const { force, ...doc } = meta.data
  const title = doc.title || deriveTitleFromFilename(file.name)

  let storagePath: string | null = null
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const buffer = Buffer.from(await file.arrayBuffer())
    const sha256 = sha256Hex(buffer)

    // Duplicate detection: identical bytes already in the library → warn + link,
    // never silently create a second copy (the screenshot-visible failure mode).
    if (!force) {
      const dup = await findDuplicateUpload(db, sha256)
      if (dup) {
        return NextResponse.json(
          {
            duplicate: true,
            document: dup,
            message: `"${dup.title}" already holds this exact file. Upload again with "keep both" to store a separate copy.`,
          },
          { status: 200 },
        )
      }
    }

    // Secure the ORIGINAL first: the row is only worth writing if the bytes are safe.
    storagePath = buildKnowledgeStoragePath(file.name, Date.now())
    const { error: upErr } = await db.storage
      .from(PRIVATE_DOCUMENTS_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) {
      logUploadFailure('storage_failed', { filename: file.name, error: upErr.message })
      return NextResponse.json({ error: 'Could not store the file. Please try again.' }, { status: 502 })
    }

    // Read the text out of the file so the AI can actually retrieve from it.
    const extraction = await extractForKnowledge(buffer, file.name, file.type || null)

    const { data, error } = await db
      .from('knowledge_documents')
      .insert({
        title,
        kind: doc.kind,
        category: doc.category ?? null,
        summary: doc.summary ?? null,
        tags: doc.tags,
        status: doc.status,
        visibility: doc.visibility,
        is_assumption: doc.is_assumption,
        source: 'upload',
        source_ref: storagePath,
        storage_path: storagePath,
        file_name: file.name,
        content_type: file.type || null,
        size_bytes: file.size,
        sha256,
        created_by: actor,
        updated_by: actor,
        ...extraction,
      })
      .select(
        'id, title, kind, category, summary, tags, status, visibility, is_assumption, file_name, content_type, size_bytes, page_count, char_count, extraction_method, extraction_confidence, low_confidence, content_truncated, extraction_error, updated_at',
      )
      .single()

    if (error || !data) {
      // Never orphan bytes without a record pointing at them.
      const cleanup = await removeObjects(db, [storagePath])
      if (!cleanup.ok) logUploadFailure('orphan_object', { storagePath, error: cleanup.error })
      return dbErrorResponse('knowledge/upload', error)
    }

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'knowledge_document',
      entityId: data.id,
      diff: {
        title: data.title,
        kind: data.kind,
        source: 'upload',
        file_name: file.name,
        size_bytes: file.size,
        sha256,
        extraction_method: extraction.extraction_method,
        pages: extraction.page_count,
        low_confidence: extraction.low_confidence,
      },
    })

    const url = await createSignedUrl(db, storagePath)
    return NextResponse.json({ document: { ...data, url } }, { status: 201 })
  } catch (e) {
    // The bytes landed but the request blew up afterwards — clean them up.
    if (storagePath) {
      try {
        await removeObjects(getDb(), [storagePath])
      } catch {
        logUploadFailure('orphan_object', { storagePath })
      }
    }
    const configured = configErrorResponse(e)
    if (configured) return configured
    logUploadFailure('failed', { error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
