import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, parseLimit } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { GatewayDisabledError } from '@/lib/ai/gateway'
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, extOf, fileFamily, sha256Hex } from '@/lib/compliance/extract'
import {
  COMPLIANCE_UPLOAD_KINDS,
} from '@/lib/validation/schemas'
import {
  buildStoragePath,
  COMPLIANCE_BUCKET,
  runExtractionForUpload,
  signedUrlFor,
} from '@/lib/compliance/uploads'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — document upload + extraction pipeline (mig 037).
// POST multipart { file, case_id?, kind?, force? }:
//   validate → hash (dedup) → secure to private bucket → record → extract page text
//   (native PDF → model-vision OCR fallback) → status through the visible stages.
// GET ?case_id= | ?id= | (recent): list uploads with fresh signed URLs + page counts.
// The original file is preserved; derived page text is stored separately. Failures
// are recorded (status=failed) and retryable — never silently dropped.

const WRITE_ROLES = ['fsa', 'licensed_staff', 'super_admin'] as const

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const sp = req.nextUrl.searchParams
  const id = sp.get('id')
  const caseId = sp.get('case_id')
  const limit = parseLimit(sp.get('limit'), 100, 300)

  try {
    const db = getDb()
    let builder = db
      .from('compliance_uploads')
      .select(
        'id, case_id, kind, filename, content_type, size_bytes, sha256, status, extraction_method, page_count, char_count, extraction_confidence, low_confidence, error, report_id, storage_path, uploaded_at, processed_at, created_at',
      )
      .order('created_at', { ascending: false })
    if (id) builder = builder.eq('id', id)
    if (caseId) builder = builder.eq('case_id', caseId)

    const { data, error } = await builder.limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const uploads = await Promise.all(
      (data ?? []).map(async (u) => {
        const url = await signedUrlFor(db, u.storage_path)
        // Never leak the raw storage path to the client; expose only a signed URL.
        const { storage_path: _omit, ...rest } = u as Record<string, unknown>
        void _omit
        return { ...rest, url }
      }),
    )
    return NextResponse.json({ uploads })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to list uploads' }, { status: 500 })
  }
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
  const caseIdRaw = String(formData.get('case_id') || '').trim()
  const caseId = caseIdRaw || null
  const kindRaw = String(formData.get('kind') || '').trim()
  const kind = (COMPLIANCE_UPLOAD_KINDS as readonly string[]).includes(kindRaw) ? kindRaw : 'other'
  const force = ['1', 'true', 'yes'].includes(String(formData.get('force') || '').toLowerCase())

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'A non-empty file is required.' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB limit.` },
      { status: 413 },
    )
  }
  const ext = extOf(file.name)
  if (!ALLOWED_EXTENSIONS.has(ext) || fileFamily(ext) === 'unsupported') {
    return NextResponse.json(
      {
        error: `File type .${ext || '(none)'} is not supported. Supported: PDF, PNG/JPG/WEBP images, and TXT/MD/CSV text.`,
        code: 'unsupported_type',
      },
      { status: 415 },
    )
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const buffer = Buffer.from(await file.arrayBuffer())
    const sha256 = sha256Hex(buffer)

    // Duplicate detection: same bytes already uploaded → warn + link (unless forced).
    if (!force) {
      const { data: dup } = await db
        .from('compliance_uploads')
        .select('id, filename, status, case_id, created_at')
        .eq('sha256', sha256)
        .neq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (dup) {
        return NextResponse.json(
          { duplicate: true, upload: dup, message: 'An identical file was already uploaded. Re-upload with force to keep a separate copy.' },
          { status: 200 },
        )
      }
    }

    // If a case_id was supplied, confirm it exists (soft — self-contained module).
    let linkedCase = caseId
    if (linkedCase) {
      const { data: c } = await db.from('nigo_cases').select('id').eq('id', linkedCase).maybeSingle()
      if (!c) linkedCase = null
    }

    // Secure the original to the private bucket.
    const storagePath = buildStoragePath(linkedCase, file.name, Date.now())
    const { error: upErr } = await db.storage
      .from(COMPLIANCE_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) {
      return NextResponse.json({ error: 'Failed to store the file. Please try again.' }, { status: 502 })
    }

    // Record the upload (status=secured), then run extraction inline.
    const { data: row, error: insErr } = await db
      .from('compliance_uploads')
      .insert({
        case_id: linkedCase,
        kind,
        filename: file.name,
        storage_path: storagePath,
        content_type: file.type || null,
        size_bytes: file.size,
        sha256,
        status: 'secured',
        created_by: actor,
      })
      .select('id, case_id, kind, filename, content_type, size_bytes, status')
      .single()
    if (insErr || !row) {
      // Roll back the stored object so we don't orphan bytes without a record.
      await db.storage.from(COMPLIANCE_BUCKET).remove([storagePath]).catch(() => {})
      return NextResponse.json({ error: insErr?.message ?? 'Failed to record upload' }, { status: 500 })
    }

    const result = await runExtractionForUpload(
      db,
      { id: row.id, filename: row.filename, content_type: row.content_type, kind: row.kind },
      buffer,
    )

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'compliance_upload',
      entityId: row.id,
      diff: { filename: file.name, kind: result.kind, status: result.status, pages: result.page_count },
    })

    const url = await signedUrlFor(db, storagePath)
    return NextResponse.json(
      {
        upload: {
          id: row.id,
          case_id: row.case_id,
          kind: result.kind,
          filename: row.filename,
          content_type: row.content_type,
          size_bytes: row.size_bytes,
          status: result.status,
          extraction_method: result.extraction_method,
          page_count: result.page_count,
          char_count: result.char_count,
          extraction_confidence: result.extraction_confidence,
          low_confidence: result.low_confidence,
          error: result.error,
          url,
        },
      },
      { status: 201 },
    )
  } catch (e) {
    if (e instanceof GatewayDisabledError) {
      return NextResponse.json({ error: e.message, code: 'ai_disabled' }, { status: 503 })
    }
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
