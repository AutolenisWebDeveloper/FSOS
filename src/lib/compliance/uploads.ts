// src/lib/compliance/uploads.ts
// DB + storage helpers for the Compliance Intelligence document pipeline (owner-
// authorized module; CLAUDE.md §3). Keeps the storage bucket path, signed-URL flow,
// and the extraction→persist state machine in one place so the POST route and the
// per-upload reprocess route share exactly one implementation.

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractDocument, PIPELINE_MODEL } from '@/lib/compliance/pipeline'
import { PARSER_VERSION, guessKind, joinPageText } from '@/lib/compliance/extract'

/** Reuse the existing private `documents` bucket (mig 001); never a public URL. */
export const COMPLIANCE_BUCKET = 'documents'
export const COMPLIANCE_PREFIX = 'compliance'
export const SIGNED_URL_TTL = 60 * 60 * 12 // 12h

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

/** Fresh short-lived signed URL for a stored object, or null. */
export async function signedUrlFor(db: Db, storagePath: string): Promise<string | null> {
  try {
    const { data } = await db.storage.from(COMPLIANCE_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}

/** Storage key for an upload: compliance/<caseId|unassigned>/<ts>-<safe-name>. */
export function buildStoragePath(caseId: string | null, filename: string, ts: number): string {
  const safe = filename.replace(/[^a-z0-9._-]/gi, '_').slice(0, 120)
  return `${COMPLIANCE_PREFIX}/${caseId ?? 'unassigned'}/${ts}-${safe}`
}

export interface ProcessableUpload {
  id: string
  filename: string
  content_type: string | null
  kind: string | null
}

export interface ProcessResult {
  status: 'extracted' | 'needs_review' | 'failed'
  page_count: number
  char_count: number
  extraction_method: string
  extraction_confidence: number | null
  low_confidence: boolean
  kind: string
  error: string | null
}

/**
 * Run extraction for an upload's bytes and persist the per-page text + the upload's
 * status/metrics. Idempotent: existing pages are replaced (safe to re-run for retry).
 * On extraction failure the upload is marked `failed` with the error (the original
 * file is preserved, and a retry is available) — never a silent drop.
 */
export async function runExtractionForUpload(
  db: Db,
  upload: ProcessableUpload,
  buffer: Buffer,
): Promise<ProcessResult> {
  await db.from('compliance_uploads').update({ status: 'extracting', error: null }).eq('id', upload.id)

  try {
    const result = await extractDocument(buffer, upload.filename, upload.content_type)

    // Replace any prior pages (reprocess path), then insert the fresh set.
    await db.from('compliance_upload_pages').delete().eq('upload_id', upload.id)
    if (result.pages.length) {
      await db.from('compliance_upload_pages').insert(
        result.pages.map((p) => ({
          upload_id: upload.id,
          page_number: p.page_number,
          text: p.text,
          char_count: p.char_count,
          low_confidence: p.low_confidence,
        })),
      )
    }

    const sample = joinPageText(result.pages).slice(0, 4000)
    const kind = upload.kind && upload.kind !== 'other' ? upload.kind : guessKind(upload.filename, sample)
    const usedModel = result.method === 'claude_pdf' || result.method === 'image'
    const status: ProcessResult['status'] = result.low_confidence ? 'needs_review' : 'extracted'

    await db
      .from('compliance_uploads')
      .update({
        status,
        page_count: result.page_count,
        char_count: result.char_count,
        extraction_method: result.method,
        extraction_confidence: result.confidence,
        low_confidence: result.low_confidence,
        kind,
        parser_version: PARSER_VERSION,
        model_version: usedModel ? PIPELINE_MODEL : null,
        processed_at: new Date().toISOString(),
        error: null,
      })
      .eq('id', upload.id)

    return {
      status,
      page_count: result.page_count,
      char_count: result.char_count,
      extraction_method: result.method,
      extraction_confidence: result.confidence,
      low_confidence: result.low_confidence,
      kind,
      error: null,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Extraction failed'
    await db
      .from('compliance_uploads')
      .update({ status: 'failed', error, processed_at: new Date().toISOString() })
      .eq('id', upload.id)
    return {
      status: 'failed',
      page_count: 0,
      char_count: 0,
      extraction_method: 'none',
      extraction_confidence: null,
      low_confidence: true,
      kind: upload.kind ?? 'other',
      error,
    }
  }
}
