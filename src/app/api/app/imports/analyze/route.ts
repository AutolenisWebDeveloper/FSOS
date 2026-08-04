import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission } from '@/lib/auth/api'
import { extensionOf } from '@/lib/spreadsheet'
import { parseContactsFile, CONTACT_FILE_EXTENSIONS } from '@/lib/contacts/parseFile'
import { buildMappingPlan, signatureHash, TARGET_FIELDS } from '@/lib/import/mapping'
import { squashHeader } from '@/lib/import/mapping'
import { loadTemplateBySignature, loadHeaderMemory, listCustomFields } from '@/lib/import/mapping/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_ROWS = 2000

// Contact Import — dry-run analysis (design spec v2.1 §7 "Preview"). Parses the
// uploaded file, detects its template by header signature, loads any saved
// mapping + per-header memory + custom-field registry, and returns the per-header
// mapping plan the operator reviews before committing. Read-only: writes nothing.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a file.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'A non-empty file is required.' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds the 8MB limit.' }, { status: 413 })
  }
  const ext = extensionOf(file.name)
  if (ext && !CONTACT_FILE_EXTENSIONS.includes(ext as (typeof CONTACT_FILE_EXTENSIONS)[number])) {
    return NextResponse.json({ error: `Unsupported file type .${ext}. Accepted: CSV, TSV, XLSX, JSON, PDF.` }, { status: 415 })
  }

  let headers: string[]
  let rows: Array<Record<string, string>>
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseContactsFile(buffer, file.name)
    headers = parsed.headers
    rows = parsed.rows
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read the file.' }, { status: 415 })
  }

  if (headers.length === 0 || rows.length === 0) {
    return NextResponse.json({ error: 'The file has no data rows to analyze.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `File has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.` }, { status: 413 })
  }

  const db = getDb()
  const signature = signatureHash(headers)
  const squashed = headers.map(squashHeader)

  // Load memory (best-effort — a memory-read failure degrades to pure recognition).
  const [saved, headerMemory, customFields] = await Promise.all([
    loadTemplateBySignature(db, signature).catch(() => null),
    loadHeaderMemory(db, squashed).catch(() => ({})),
    listCustomFields(db).catch(() => []),
  ])

  const plan = buildMappingPlan({
    headers,
    rows,
    savedHeaderMap: saved?.headerMap,
    headerMemory,
  })

  return NextResponse.json({
    filename: file.name,
    format: ext || 'csv',
    total_rows: rows.length,
    signature,
    detected_template: plan.template ? { key: plan.template.key, name: plan.template.name, shape: plan.template.shape } : null,
    saved_template: saved ? { name: saved.name, template_key: saved.templateKey } : null,
    plan: { entries: plan.entries, unrecognized: plan.unrecognized },
    fields: TARGET_FIELDS,
    custom_fields: customFields,
  })
}
