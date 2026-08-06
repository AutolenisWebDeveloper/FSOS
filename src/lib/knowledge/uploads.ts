// src/lib/knowledge/uploads.ts
// AI Knowledge Library — turn an UPLOADED FILE into a retrievable knowledge document.
//
// Until now the library could only accept text pasted into a textarea: there was no
// way to hand it the actual PDF, scan, notice, or one-pager the knowledge came from.
// This module owns that path so /api/knowledge/upload stays a thin handler
// (CLAUDE.md §3.1.8):
//
//   validate → hash (dedup) → secure the ORIGINAL to the private `documents` bucket
//   → extract page text (native PDF → model-vision OCR fallback) → index the text as
//   `content` so the existing full-text retrieval finds it → keep the original for
//   download via a short-lived signed URL.
//
// Extraction is the SHARED implementation from the document pipeline
// (`lib/compliance/pipeline`) — reused, not cloned (§6). That import is a pure
// bytes→text function call: it reads no compliance table and creates no link into the
// isolated Compliance Intelligence module (§5 / ADR-012), so the bounded contexts
// stay separate.
//
// GUARDRAILS honored here:
//   • No invented content — the indexed text is exactly what the bytes contained. A
//     thin/failed extraction is recorded and surfaced as low-confidence, never
//     presented as complete knowledge (§4.3).
//   • Farmers-specific values stay assumption-flagged by the uploader and continue to
//     reach the model wrapped in the "config default — verify" note (§4.3).
//   • The original never gets a public URL — private bucket + signed URL only.

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractDocument } from '@/lib/compliance/pipeline'
import {
  extOf,
  fileFamily,
  joinPageText,
  sha256Hex,
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
} from '@/lib/compliance/extract'
import { buildObjectPath, PRIVATE_DOCUMENTS_BUCKET, removeObjects } from '@/lib/storage/private-documents'
import { KNOWLEDGE_CONTENT_MAX } from '@/lib/validation/schemas'

/** Bucket prefix that separates library files from other uploads in the bucket. */
export const KNOWLEDGE_PREFIX = 'knowledge'

/**
 * Ceiling on the extracted text stored in `content` — the SAME bound the create/edit
 * form validates against, so an uploaded document stays editable afterwards. A
 * knowledge row is tokenized into `search_tsv` on every write, so an unbounded
 * book-length dump would degrade retrieval. The ORIGINAL file is always stored whole
 * and downloadable; only the indexed text is clipped, and the clip is disclosed
 * (`content_truncated`) rather than silently swallowed.
 */
export const MAX_KNOWLEDGE_CONTENT_CHARS = KNOWLEDGE_CONTENT_MAX

export const TRUNCATION_NOTICE =
  '\n\n[Indexed text was clipped at the library limit. The complete original file is attached and can be downloaded.]'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

// ─── Validation ───────────────────────────────────────────────────────────────

export interface UploadCandidate {
  name: string
  size: number
}

export type UploadRejection =
  | { code: 'empty'; status: 400; message: string }
  | { code: 'too_large'; status: 413; message: string }
  | { code: 'unsupported_type'; status: 415; message: string }

const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

export const SUPPORTED_UPLOAD_HINT =
  'Supported: PDF, PNG/JPG/WEBP/GIF images, and TXT/MD/CSV text.'

/**
 * Reject a file the library cannot secure or read. Returns null when the file is
 * acceptable. Pure — the route calls this before touching storage so a bad upload
 * never leaves bytes behind.
 */
export function rejectUpload(file: UploadCandidate | null): UploadRejection | null {
  if (!file || file.size <= 0) {
    return { code: 'empty', status: 400, message: 'Choose a non-empty file to upload.' }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { code: 'too_large', status: 413, message: `That file is larger than the ${MAX_MB}MB limit.` }
  }
  const ext = extOf(file.name)
  if (!ALLOWED_EXTENSIONS.has(ext) || fileFamily(ext) === 'unsupported') {
    return {
      code: 'unsupported_type',
      status: 415,
      message: `File type .${ext || '(none)'} isn't supported. ${SUPPORTED_UPLOAD_HINT}`,
    }
  }
  return null
}

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Human title from a filename when the uploader didn't type one: drop the extension,
 * turn separators into spaces, collapse whitespace, and cap at the column length.
 * Falls back to the raw filename (then a generic label) rather than an empty title.
 */
export function deriveTitleFromFilename(filename: string): string {
  const base = (filename || '').split(/[\\/]/).pop() ?? ''
  const noExt = base.replace(/\.[^.]+$/, '')
  const spaced = noExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (spaced || base.trim() || 'Uploaded document').slice(0, 240)
}

/** Storage key for a library upload: `knowledge/<yyyy-mm>/<ts>-<safe-name>`. */
export function buildKnowledgeStoragePath(filename: string, ts: number): string {
  const d = new Date(ts)
  const scope = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return buildObjectPath(KNOWLEDGE_PREFIX, scope, filename, ts)
}

export interface IndexedContent {
  content: string
  truncated: boolean
}

/**
 * Assemble the retrievable text from extracted pages, clipping to the library ceiling
 * with a visible notice. Pages are joined as prose (no page markers): this text is fed
 * to the drafting model as background, where markers read as noise — the original PDF
 * remains the page-accurate reference.
 *
 * The RESULT — body plus notice — stays within the ceiling, not just the clipped body.
 * Appending the notice on top of a full-length slice would push the stored text past
 * the edit form's own max, and a truncated upload would become uneditable.
 */
export function buildIndexedContent(pages: { text: string }[]): IndexedContent {
  const full = joinPageText(pages).trim()
  if (full.length <= MAX_KNOWLEDGE_CONTENT_CHARS) return { content: full, truncated: false }
  const room = Math.max(0, MAX_KNOWLEDGE_CONTENT_CHARS - TRUNCATION_NOTICE.length)
  return { content: full.slice(0, room).trimEnd() + TRUNCATION_NOTICE, truncated: true }
}

// ─── Ingestion ────────────────────────────────────────────────────────────────

export interface ExtractionRecord {
  content: string
  content_truncated: boolean
  page_count: number
  char_count: number
  extraction_method: string
  extraction_confidence: number | null
  low_confidence: boolean
  extraction_error: string | null
}

/**
 * Extract a stored file's text into the shape written onto `knowledge_documents`.
 *
 * A failed extraction is NOT an upload failure: the original is already secured and
 * remains downloadable, so we record the error, mark the row low-confidence with empty
 * indexed text, and let the FSA paste or retype the content. Failing the whole upload
 * would throw away a file the user already handed us (§16.5 — degrade, don't lose data).
 */
export async function extractForKnowledge(
  buffer: Buffer,
  filename: string,
  contentType: string | null,
): Promise<ExtractionRecord> {
  try {
    const result = await extractDocument(buffer, filename, contentType)
    const { content, truncated } = buildIndexedContent(result.pages)
    return {
      content,
      content_truncated: truncated,
      page_count: result.page_count,
      char_count: result.char_count,
      extraction_method: result.method,
      extraction_confidence: result.confidence,
      // An empty extraction is never treated as "this document says nothing".
      low_confidence: result.low_confidence || content.length === 0,
      extraction_error: null,
    }
  } catch (e) {
    return {
      content: '',
      content_truncated: false,
      page_count: 0,
      char_count: 0,
      extraction_method: 'none',
      extraction_confidence: null,
      low_confidence: true,
      extraction_error: e instanceof Error ? e.message : 'Text extraction failed',
    }
  }
}

/** An existing library row that already holds the same bytes. */
export interface DuplicateHit {
  id: string
  title: string
  status: string
  file_name: string | null
  updated_at: string
}

/**
 * Look for a live (non-archived) library document holding identical bytes. Returns
 * null when there is none or when the lookup fails — a dedup miss must never block a
 * legitimate upload.
 */
export async function findDuplicateUpload(db: Db, sha256: string): Promise<DuplicateHit | null> {
  try {
    const { data } = await db
      .from('knowledge_documents')
      .select('id, title, status, file_name, updated_at')
      .eq('sha256', sha256)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as DuplicateHit | null) ?? null
  } catch {
    return null
  }
}

// ─── The ingest sequence (store → extract → persist → audit) ──────────────────
//
// This lives here rather than in the route handler so the route stays thin
// (CLAUDE.md §3.1.8): it parses, authorizes, calls this, and shapes a response.

/** Columns returned to the client after a successful ingest (never storage_path). */
const INGESTED_COLUMNS =
  'id, title, kind, category, summary, tags, status, visibility, is_assumption, file_name, content_type, ' +
  'size_bytes, page_count, char_count, extraction_method, extraction_confidence, low_confidence, ' +
  'content_truncated, extraction_error, updated_at'

export interface IngestInput {
  buffer: Buffer
  filename: string
  contentType: string | null
  sizeBytes: number
  actor: string
  /** Validated metadata from KnowledgeUploadMetaSchema, minus `force`. */
  meta: {
    title?: string
    kind: string
    category?: string
    summary?: string
    tags: string[]
    status: string
    visibility: string
    is_assumption: boolean
  }
  /** Skip duplicate detection — the operator explicitly chose to keep both copies. */
  force: boolean
}

export type IngestResult =
  | { kind: 'duplicate'; existing: DuplicateHit }
  | { kind: 'storage_failed'; message: string }
  | { kind: 'insert_failed'; error: { message?: string; code?: string } | null; orphanedPath: string | null }
  | { kind: 'created'; document: Record<string, unknown>; storagePath: string; audit: Record<string, unknown> }

/**
 * Secure an uploaded file and turn it into a retrievable knowledge document.
 *
 * Ordering matters and is deliberate:
 *   1. hash + dedup — never silently create a second copy of the same bytes;
 *   2. store the ORIGINAL first — a row is only worth writing if the file is safe;
 *   3. extract text — a failure here is recorded, not fatal (the file is already kept);
 *   4. insert the row — and roll the stored object back if that fails, so bytes are
 *      never orphaned without a record pointing at them.
 *
 * Returns a discriminated result; the caller maps it to a status code and audits.
 */
export async function ingestKnowledgeFile(db: Db, input: IngestInput): Promise<IngestResult> {
  const { buffer, filename, contentType, sizeBytes, actor, meta, force } = input
  const sha256 = sha256Hex(buffer)

  if (!force) {
    const existing = await findDuplicateUpload(db, sha256)
    if (existing) return { kind: 'duplicate', existing }
  }

  const storagePath = buildKnowledgeStoragePath(filename, Date.now())
  const { error: upErr } = await db.storage
    .from(PRIVATE_DOCUMENTS_BUCKET)
    .upload(storagePath, buffer, { contentType: contentType || 'application/octet-stream', upsert: false })
  if (upErr) return { kind: 'storage_failed', message: upErr.message }

  // Past this point the bytes are stored, so every exit must either produce a row or
  // remove them again — an orphaned object with no record pointing at it is a leak.
  try {
    return await persistIngestedFile(db, input, storagePath, sha256)
  } catch (e) {
    const cleanup = await removeObjects(db, [storagePath])
    return {
      kind: 'insert_failed',
      error: { message: e instanceof Error ? e.message : 'Failed to record the upload' },
      orphanedPath: cleanup.ok ? null : storagePath,
    }
  }
}

/** Extract the stored file's text and write the knowledge row. Assumes bytes are stored. */
async function persistIngestedFile(
  db: Db,
  { buffer, filename, contentType, sizeBytes, actor, meta }: IngestInput,
  storagePath: string,
  sha256: string,
): Promise<IngestResult> {
  const extraction = await extractForKnowledge(buffer, filename, contentType)

  const { data, error } = await db
    .from('knowledge_documents')
    .insert({
      title: meta.title || deriveTitleFromFilename(filename),
      kind: meta.kind,
      category: meta.category ?? null,
      summary: meta.summary ?? null,
      tags: meta.tags,
      status: meta.status,
      visibility: meta.visibility,
      is_assumption: meta.is_assumption,
      source: 'upload',
      source_ref: storagePath,
      storage_path: storagePath,
      file_name: filename,
      content_type: contentType,
      size_bytes: sizeBytes,
      sha256,
      created_by: actor,
      updated_by: actor,
      ...extraction,
    })
    .select(INGESTED_COLUMNS)
    .single()

  if (error || !data) {
    const cleanup = await removeObjects(db, [storagePath])
    return { kind: 'insert_failed', error, orphanedPath: cleanup.ok ? null : storagePath }
  }

  // supabase-js over-infers on a string select with a generic client; the shape is
  // INGESTED_COLUMNS, which the route only reads and forwards.
  const row = data as unknown as { id: string; title: string } & Record<string, unknown>
  return {
    kind: 'created',
    document: row,
    storagePath,
    audit: {
      title: row.title,
      kind: meta.kind,
      source: 'upload',
      file_name: filename,
      size_bytes: sizeBytes,
      sha256,
      extraction_method: extraction.extraction_method,
      pages: extraction.page_count,
      low_confidence: extraction.low_confidence,
    },
  }
}
