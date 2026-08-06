import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { KnowledgeUploadMetaSchema } from '@/lib/validation/schemas'
import { ingestKnowledgeFile, rejectUpload, SUPPORTED_UPLOAD_HINT } from '@/lib/knowledge/uploads'
import { createSignedUrl } from '@/lib/storage/private-documents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Knowledge Library — upload the ACTUAL FILE behind a knowledge document.
//
// POST multipart { file, title?, kind?, category?, summary?, tags?, status?,
//                  visibility?, is_assumption?, force? }.
//
// Thin handler (CLAUDE.md §3.1.8): authorize → parse + Zod-validate → hand the bytes
// to `ingestKnowledgeFile` (store privately → extract text → persist → roll back on
// failure) → map the result to a status code and audit it. All the ordering rules
// live in the service, next to the functions they constrain.
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

  // Reject what the library cannot secure or read BEFORE any bytes reach storage.
  const file = formData.get('file')
  const rejection = rejectUpload(file instanceof File ? { name: file.name, size: file.size } : null)
  if (rejection || !(file instanceof File)) {
    const r = rejection ?? { code: 'empty' as const, status: 400, message: 'Choose a non-empty file to upload.' }
    return NextResponse.json({ error: r.message, code: r.code, hint: SUPPORTED_UPLOAD_HINT }, { status: r.status })
  }

  // Validate the accompanying metadata with the same bounds as the manual form.
  const parsed = KnowledgeUploadMetaSchema.safeParse({
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
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid document details', details: parsed.error.flatten() }, { status: 400 })
  }
  const { force, ...meta } = parsed.data

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const result = await ingestKnowledgeFile(db, {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      contentType: file.type || null,
      sizeBytes: file.size,
      actor,
      meta,
      force,
    })

    switch (result.kind) {
      case 'duplicate':
        return NextResponse.json(
          {
            duplicate: true,
            document: result.existing,
            message: `"${result.existing.title}" already holds this exact file. Upload again with "keep both" to store a separate copy.`,
          },
          { status: 200 },
        )

      case 'storage_failed':
        logUploadFailure('storage_failed', { filename: file.name, error: result.message })
        return NextResponse.json({ error: 'Could not store the file. Please try again.' }, { status: 502 })

      case 'insert_failed':
        if (result.orphanedPath) logUploadFailure('orphan_object', { storagePath: result.orphanedPath })
        return dbErrorResponse('knowledge/upload', result.error)

      case 'created': {
        await writeAudit({
          actor,
          action: 'entity.created',
          entity: 'knowledge_document',
          entityId: String(result.document.id),
          diff: result.audit,
        })
        const url = await createSignedUrl(db, result.storagePath)
        return NextResponse.json({ document: { ...result.document, url } }, { status: 201 })
      }
    }
  } catch (e) {
    const configured = configErrorResponse(e)
    if (configured) return configured
    logUploadFailure('failed', { error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
