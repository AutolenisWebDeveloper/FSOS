import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { extensionOf } from '@/lib/spreadsheet'
import { parseContactsFile, CONTACT_FILE_EXTENSIONS } from '@/lib/contacts/parseFile'
import { resolveColumns, mapAndValidateRow, type CanonicalField } from '@/lib/ghlContacts'
import { aiDetectColumns } from '@/lib/columnAI'
import { classifyContacts, routeForType, type ContactType } from '@/lib/ai/contactRouter'
import { emailLc, phoneDigits } from '@/lib/contacts/normalize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 2000

type RowStatus = 'imported' | 'duplicate' | 'invalid'
interface RowResult {
  row_number: number
  full_name: string | null
  email: string | null
  phone: string | null
  status: RowStatus
  contact_type: ContactType | null
  error_message: string | null
}

// Contact Center — bulk import contacts (CSV / TSV / XLSX / JSON) stored natively
// in App B. Recognizes columns (exact → AI → content), validates, de-duplicates
// (in-file + against existing contacts), categorizes each contact (AI router,
// green-zone identify), auto-tags, and inserts. RBAC-gated + audited. Outbound GHL
// sync is a separate action; this import's system of record is App B.
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
    return NextResponse.json({ error: 'File exceeds the 5MB limit.' }, { status: 413 })
  }
  const ext = extensionOf(file.name)
  if (ext && !CONTACT_FILE_EXTENSIONS.includes(ext as (typeof CONTACT_FILE_EXTENSIONS)[number])) {
    return NextResponse.json({ error: `Unsupported file type .${ext}. Accepted: CSV, TSV, XLSX, JSON.` }, { status: 415 })
  }

  const batchTags = String(formData.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean)
  const source = String(formData.get('source') || '').trim() || `import:${ext || 'file'}`
  const useAi = String(formData.get('ai') || 'true').trim().toLowerCase() !== 'false'
  const useRouting = String(formData.get('ai_route') || 'true').trim().toLowerCase() !== 'false'

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
    return NextResponse.json({ error: 'The file has no data rows to import.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `File has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.` }, { status: 413 })
  }

  const aiResult = useAi ? await aiDetectColumns(headers, rows) : null
  const resolved = resolveColumns(headers, rows, aiResult?.map)
  const colMap: Record<string, CanonicalField> = resolved.map
  const mapped = new Set(Object.values(colMap))
  const hasName = mapped.has('first_name') || mapped.has('last_name') || mapped.has('full_name')
  const hasContact = mapped.has('email') || mapped.has('phone')
  if (!hasName || !hasContact) {
    return NextResponse.json({ error: 'Could not recognize the required columns. Need a name and at least one of email or phone.', detected_columns: colMap, detection_method: resolved.method, headers }, { status: 422 })
  }

  const db = getDb()
  const actor = actorOf(auth.session)

  // Map + validate + in-file dedupe.
  const results: RowResult[] = new Array(rows.length)
  const seen = new Set<string>()
  const candidates: Array<{ index: number; contact: NonNullable<ReturnType<typeof mapAndValidateRow>['contact']> }> = []
  rows.forEach((record, i) => {
    const rowNumber = i + 1
    const { contact, errors } = mapAndValidateRow(record, colMap, { tags: batchTags, source })
    if (!contact) {
      results[i] = { row_number: rowNumber, full_name: null, email: null, phone: null, status: 'invalid', contact_type: null, error_message: errors.join('; ') }
      return
    }
    if (seen.has(contact.dedupeKey)) {
      results[i] = { row_number: rowNumber, full_name: contact.label, email: contact.email, phone: contact.phone, status: 'duplicate', contact_type: null, error_message: 'Duplicate row within this file' }
      return
    }
    seen.add(contact.dedupeKey)
    candidates.push({ index: i, contact })
  })

  // Duplicate detection against existing App B contacts (normalized email/phone).
  const emails = Array.from(new Set(candidates.map((c) => emailLc(c.contact.email)).filter((x): x is string => !!x)))
  const phones = Array.from(new Set(candidates.map((c) => phoneDigits(c.contact.phone)).filter((x): x is string => !!x)))
  const existingEmail = new Set<string>()
  const existingPhone = new Set<string>()
  if (emails.length) {
    const { data } = await db.from('contacts').select('email_lc').in('email_lc', emails).is('deleted_at', null)
    for (const r of data || []) if (r.email_lc) existingEmail.add(r.email_lc)
  }
  if (phones.length) {
    const { data } = await db.from('contacts').select('phone_digits').in('phone_digits', phones).is('deleted_at', null)
    for (const r of data || []) if (r.phone_digits) existingPhone.add(r.phone_digits)
  }

  const toInsertIdx: number[] = []
  const toClassify: (typeof candidates)[number]['contact'][] = []
  for (const cand of candidates) {
    const eLc = emailLc(cand.contact.email)
    const pDig = phoneDigits(cand.contact.phone)
    const dup = (eLc && existingEmail.has(eLc)) || (pDig && existingPhone.has(pDig))
    if (dup) {
      results[cand.index] = { row_number: cand.index + 1, full_name: cand.contact.label, email: cand.contact.email, phone: cand.contact.phone, status: 'duplicate', contact_type: null, error_message: 'Already exists in Contacts' }
    } else {
      toInsertIdx.push(cand.index)
      toClassify.push(cand.contact)
    }
  }

  // Categorize (green-zone identify) — falls back to 'unknown' if the gateway is off.
  const classify = useRouting
    ? await classifyContacts(toClassify)
    : { classifications: [] as { type: ContactType; confidence: number }[], aiUsed: false, aiCapped: 0, model: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }

  const routeCounts: Record<string, number> = {}
  const insertRows = toInsertIdx.map((rowIdx, k) => {
    const c = toClassify[k]
    const cls = useRouting ? classify.classifications[k] : null
    const type: ContactType = cls?.type ?? 'unknown'
    const route = routeForType(type)
    const tags = Array.from(new Set([...c.tags, ...(useRouting ? route.tags : [])]))
    if (useRouting) routeCounts[type] = (routeCounts[type] || 0) + 1
    results[rowIdx] = { row_number: rowIdx + 1, full_name: c.label, email: c.email, phone: c.phone, status: 'imported', contact_type: type, error_message: null }
    return {
      first_name: c.firstName || null,
      last_name: c.lastName || null,
      full_name: c.label,
      email: c.email,
      email_lc: emailLc(c.email),
      phone: c.phone,
      phone_digits: phoneDigits(c.phone),
      contact_type: type,
      tags,
      source: c.source,
      status: 'active',
      owner_scope: auth.session.userId ?? null,
      created_by: actor,
    }
  })

  if (insertRows.length) {
    const { error } = await db.from('contacts').insert(insertRows)
    if (error) return NextResponse.json({ error: `Import failed on write: ${error.message}` }, { status: 500 })
  }

  const counts = {
    imported: results.filter((r) => r?.status === 'imported').length,
    duplicate: results.filter((r) => r?.status === 'duplicate').length,
    invalid: results.filter((r) => r?.status === 'invalid').length,
  }

  await writeAudit({ actor, action: 'import.committed', entity: 'contacts_import', entityId: null, diff: { filename: file.name, format: ext || 'csv', total: rows.length, counts, routing: useRouting ? routeCounts : null } })

  return NextResponse.json({
    success: true,
    filename: file.name,
    format: ext || 'csv',
    total: rows.length,
    counts,
    detection_method: resolved.method,
    ai_used: !!aiResult,
    routing: { enabled: useRouting, ai_used: classify.aiUsed, counts: routeCounts, capped: classify.aiCapped },
    rows: results,
  })
}
