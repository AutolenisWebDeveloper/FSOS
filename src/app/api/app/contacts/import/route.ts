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
import { buildContactIndex, resolveContact, mergeFields, type Resolution } from '@/lib/import/resolution'
import { createBatch, writeRecords, loadContactCandidates, type RecordInput } from '@/lib/import/auditWriter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_ROWS = 2000
const CHUNK = 500

type RowStatus = 'imported' | 'merged' | 'review' | 'invalid' | 'duplicate'
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
    return NextResponse.json({ error: `Unsupported file type .${ext}. Accepted: CSV, TSV, XLSX, JSON, PDF.` }, { status: 415 })
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

  // Resolve every row against the whole Contact Center with the shared engine:
  // a reliable identifier (email / phone / provenance / name+qualifier) merges in
  // place; a name-only or conflicting match is queued for manual review; an
  // unknown row is created. This is the same logic every importer uses.
  const index = buildContactIndex(await loadContactCandidates(db))
  const resolutions = candidates.map((cand) => ({
    ...cand,
    res: resolveContact(index, { fullName: cand.contact.label, email: cand.contact.email, phone: cand.contact.phone }),
  }))
  const toCreate = resolutions.filter((r) => r.res.action === 'create')
  const toMerge = resolutions.filter((r) => r.res.action === 'merge' && r.res.targetId)
  const toReview = resolutions.filter((r) => r.res.action === 'review' || (r.res.action === 'merge' && !r.res.targetId))

  // Full current rows for the merge targets (no-overwrite needs existing values).
  const mergeIds = Array.from(new Set(toMerge.map((r) => r.res.targetId!)))
  const existingById = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < mergeIds.length; i += CHUNK) {
    const { data } = await db.from('contacts').select('id, full_name, first_name, last_name, email, email_lc, phone, phone_digits, tags, contact_type').in('id', mergeIds.slice(i, i + CHUNK)).is('deleted_at', null)
    for (const r of data || []) existingById.set(r.id as string, r)
  }

  const records: Omit<RecordInput, 'batchId'>[] = []
  const ownerScope = auth.session.userId ?? null

  // 1. MERGE — no-overwrite; union tags; capture rejected values for the audit.
  const MERGE_SPEC = [
    { field: 'email' }, { field: 'email_lc' }, { field: 'phone' }, { field: 'phone_digits' },
    { field: 'first_name' }, { field: 'last_name' }, { field: 'tags', kind: 'set' as const },
  ]
  for (const p of toMerge) {
    const ex = existingById.get(p.res.targetId!) || {}
    const incoming: Record<string, unknown> = {
      email: p.contact.email, email_lc: emailLc(p.contact.email),
      phone: p.contact.phone, phone_digits: phoneDigits(p.contact.phone),
      first_name: p.contact.firstName || null, last_name: p.contact.lastName || null,
      tags: Array.from(new Set([...p.contact.tags, ...batchTags])),
    }
    const { patch, merged, rejected } = mergeFields(ex, incoming, MERGE_SPEC)
    if (ex.contact_type === 'unknown' && (p.contact.declaredType && p.contact.declaredType !== 'unknown')) {
      patch.contact_type = p.contact.declaredType
      merged.push('contact_type')
    }
    if (Object.keys(patch).length) {
      const { error } = await db.from('contacts').update(patch).eq('id', p.res.targetId!).is('deleted_at', null)
      if (error) return NextResponse.json({ error: `Merge failed: ${error.message}` }, { status: 500 })
    }
    results[p.index] = { row_number: p.index + 1, full_name: p.contact.label, email: p.contact.email, phone: p.contact.phone, status: 'merged', contact_type: (ex.contact_type as ContactType) ?? null, error_message: null }
    records.push({ entityType: 'contact', raw: rows[p.index], decision: { ...p.res }, targetId: p.res.targetId, mergedFields: merged, rejectedValues: rejected, confidence: p.res.confidence, reviewStatus: 'auto', ownerScope })
  }

  // 2. REVIEW — never write; queue with full context (raw + normalized incoming
  //    + candidates) so a human can merge into a candidate or create a new record.
  for (const p of toReview) {
    const incoming = {
      full_name: p.contact.label, first_name: p.contact.firstName || null, last_name: p.contact.lastName || null,
      email: p.contact.email, email_lc: emailLc(p.contact.email), phone: p.contact.phone, phone_digits: phoneDigits(p.contact.phone),
      contact_type: p.contact.declaredType || 'unknown', tags: Array.from(new Set([...p.contact.tags, ...batchTags])), source: p.contact.source,
    }
    results[p.index] = { row_number: p.index + 1, full_name: p.contact.label, email: p.contact.email, phone: p.contact.phone, status: 'review', contact_type: null, error_message: p.res.conflict ? 'Ambiguous match — needs review' : 'No reliable match — needs review' }
    records.push({ entityType: 'contact', raw: rows[p.index], decision: { ...p.res, incoming }, targetId: p.res.targetId, confidence: p.res.confidence, reviewStatus: 'needs_review', ownerScope })
  }

  // 3. CREATE — categorize (green-zone identify) + insert new contacts.
  const toClassify = toCreate.map((p) => p.contact)
  const classify = useRouting
    ? await classifyContacts(toClassify)
    : { classifications: [] as { type: ContactType; confidence: number }[], aiUsed: false, aiCapped: 0, model: '', inputTokens: 0, outputTokens: 0, costUsd: 0 }
  const routeCounts: Record<string, number> = {}
  const insertRows = toCreate.map((p, k) => {
    const c = p.contact
    const type: ContactType = (useRouting ? classify.classifications[k]?.type : null) ?? 'unknown'
    const route = routeForType(type)
    const tags = Array.from(new Set([...c.tags, ...(useRouting ? route.tags : [])]))
    if (useRouting) routeCounts[type] = (routeCounts[type] || 0) + 1
    results[p.index] = { row_number: p.index + 1, full_name: c.label, email: c.email, phone: c.phone, status: 'imported', contact_type: type, error_message: null }
    records.push({ entityType: 'contact', raw: rows[p.index], decision: { ...p.res }, confidence: 'none', reviewStatus: 'auto', ownerScope })
    return {
      first_name: c.firstName || null, last_name: c.lastName || null, full_name: c.label,
      email: c.email, email_lc: emailLc(c.email), phone: c.phone, phone_digits: phoneDigits(c.phone),
      contact_type: type, tags, source: c.source, status: 'active', owner_scope: ownerScope, created_by: actor,
    }
  })
  if (insertRows.length) {
    const { error } = await db.from('contacts').insert(insertRows)
    if (error) return NextResponse.json({ error: `Import failed on write: ${error.message}` }, { status: 500 })
  }

  const counts = {
    imported: results.filter((r) => r?.status === 'imported').length,
    merged: results.filter((r) => r?.status === 'merged').length,
    review: results.filter((r) => r?.status === 'review').length,
    duplicate: results.filter((r) => r?.status === 'duplicate').length,
    invalid: results.filter((r) => r?.status === 'invalid').length,
  }

  // Audit trail: one batch + one record per imported row (raw + decision + merged + rejected).
  const batchId = await createBatch(db, { source: 'contacts', filename: file.name, actor, ownerScope, stats: { total: rows.length, counts, format: ext || 'csv' } })
  if (batchId) await writeRecords(db, records.map((r) => ({ ...r, batchId })))

  await writeAudit({ actor, action: 'import.committed', entity: 'contacts_import', entityId: null, diff: { filename: file.name, format: ext || 'csv', total: rows.length, counts, routing: useRouting ? routeCounts : null } })

  return NextResponse.json({
    success: true,
    filename: file.name,
    format: ext || 'csv',
    total: rows.length,
    counts,
    detection_method: resolved.method,
    ai_used: !!aiResult,
    batch_id: batchId,
    routing: { enabled: useRouting, ai_used: classify.aiUsed, counts: routeCounts, capped: classify.aiCapped },
    rows: results,
  })
}
