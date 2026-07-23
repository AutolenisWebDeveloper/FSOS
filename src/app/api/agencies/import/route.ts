import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { parseLimit, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { parseSpreadsheet, extensionOf, SUPPORTED_EXTENSIONS } from '@/lib/spreadsheet'
import { mapAndValidateAgency, resolveAgencyColumns, type MappedAgency } from '@/lib/agencyDirectory'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-02 Agency Directory bulk import. Upload a Farmers agent directory (CSV/XLSX)
// and create agency-partnership + owner pairs on the aggregate-root spine — the
// batch equivalent of POST /api/agencies. RBAC-gated (create = fsa/super, same as
// the single-create route), deduped (in-file + against-DB by agent code / email),
// and fully audited (import_batches / import_records + audit_log). These are the
// FSA's own partnership prospects — not client comms — so this is not consent-gated
// here; outbound messaging stays gated at send time by the comms dispatcher.
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_ROWS = 500 // each row fans out to 4 dependent inserts

type RowStatus = 'success' | 'duplicate' | 'invalid' | 'failed'

interface RowResult {
  row_number: number
  agent_code: string | null
  owner_name: string | null
  email: string | null
  status: RowStatus
  agency_id: string | null
  error_message: string | null
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'super_admin'])
  if (denied) return denied

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a CSV or Excel file.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'A non-empty CSV or Excel (.xlsx) file is required.' }, { status: 400 })
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'File exceeds the 5MB limit.' }, { status: 413 })
  }
  const ext = extensionOf(file.name)
  if (ext && !SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) {
    const hint = ext === 'xls' ? ' Re-save legacy .xls as .xlsx or .csv.' : ''
    return NextResponse.json({ error: `Only .csv and .xlsx files are accepted (got .${ext}).${hint}` }, { status: 415 })
  }

  const defaultState = String(formData.get('default_state') || '').trim() || undefined

  let headers: string[]
  let rows: Array<Record<string, string>>
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseSpreadsheet(buffer, file.name)
    headers = parsed.headers
    rows = parsed.rows
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read the file.' }, { status: 415 })
  }

  if (headers.length === 0 || rows.length === 0) {
    return NextResponse.json({ error: 'The file has no data rows to import.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `File has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.` },
      { status: 413 },
    )
  }

  const { map: colMap, hasName, hasIdentifier } = resolveAgencyColumns(headers)
  if (!hasName || !hasIdentifier) {
    return NextResponse.json(
      {
        error:
          'Could not recognize the required columns. The directory needs a name (full name, or first + last) and at least one identifier (agent code, email, or phone).',
        detected_columns: colMap,
        headers,
      },
      { status: 422 },
    )
  }

  // ── Map + in-file dedupe ───────────────────────────────────────────────────
  const results: RowResult[] = new Array(rows.length)
  const toImport: Array<{ index: number; agency: MappedAgency }> = []
  const seen = new Set<string>()

  rows.forEach((record, i) => {
    const rowNumber = i + 1
    const { agency, errors } = mapAndValidateAgency(record, colMap, { state: defaultState })
    if (!agency) {
      results[i] = { row_number: rowNumber, agent_code: null, owner_name: null, email: null, status: 'invalid', agency_id: null, error_message: errors.join('; ') }
      return
    }
    if (seen.has(agency.dedupeKey)) {
      results[i] = { row_number: rowNumber, agent_code: agency.agent_code, owner_name: agency.owner_name, email: agency.email, status: 'duplicate', agency_id: null, error_message: `Duplicate of an earlier row (${agency.dedupeKey})` }
      return
    }
    seen.add(agency.dedupeKey)
    toImport.push({ index: i, agency })
  })

  const db = getDb()
  const actor = actorOf(auth.session)

  // ── Against-DB dedupe: skip agents already on the spine ────────────────────
  try {
    const codes = Array.from(new Set(toImport.map((t) => t.agency.agent_code).filter((c): c is string => !!c)))
    const emails = Array.from(new Set(toImport.map((t) => t.agency.email).filter((e): e is string => !!e)))
    const existingCodes = new Set<string>()
    const existingEmails = new Set<string>()
    if (codes.length) {
      const { data } = await db.from('agency_partnerships').select('fnwl_serving_agent_no').in('fnwl_serving_agent_no', codes).is('deleted_at', null)
      for (const r of data ?? []) if (r.fnwl_serving_agent_no) existingCodes.add(String(r.fnwl_serving_agent_no).toUpperCase())
    }
    if (emails.length) {
      const { data } = await db.from('agency_owners').select('email').in('email', emails)
      for (const r of data ?? []) if (r.email) existingEmails.add(String(r.email).toLowerCase())
    }
    for (let k = toImport.length - 1; k >= 0; k--) {
      const { index, agency } = toImport[k]
      const codeDup = agency.agent_code && existingCodes.has(agency.agent_code.toUpperCase())
      const emailDup = agency.email && existingEmails.has(agency.email.toLowerCase())
      if (codeDup || emailDup) {
        results[index] = { row_number: index + 1, agent_code: agency.agent_code, owner_name: agency.owner_name, email: agency.email, status: 'duplicate', agency_id: null, error_message: codeDup ? 'An agency with this agent code already exists.' : 'An owner with this email already exists.' }
        toImport.splice(k, 1)
      }
    }
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not check for existing agencies.' }, { status: 500 })
  }

  // ── Open the import batch (audit trail) ────────────────────────────────────
  const { data: batch, error: batchErr } = await db
    .from('import_batches')
    .insert({ source: 'agency', filename: file.name, actor, owner_scope: actor, stats: { total_rows: rows.length } })
    .select('id')
    .single()
  if (batchErr || !batch) {
    return configErrorResponse(batchErr) ?? NextResponse.json({ error: 'Could not start the import (database error).' }, { status: 500 })
  }
  const batchId = batch.id as string

  // ── Create partnership + owner pairs (sequential: dependent inserts) ───────
  const importRecords: Array<Record<string, unknown>> = []
  for (const { index, agency } of toImport) {
    const rowNumber = index + 1
    const raw = rows[index]
    try {
      const { data: created, error } = await db
        .from('agency_partnerships')
        .insert({
          agency_name: agency.agency_name,
          owner_name: agency.owner_name,
          status: 'prospective',
          fnwl_serving_agent_no: agency.agent_code,
          office_address: agency.office_address,
          office_city: agency.office_city,
          office_state: agency.office_state,
          office_zip: agency.office_zip,
          existing_leads_user: agency.existing_leads_user,
          interested: agency.interested,
          owner_scope: actor,
        })
        .select('id')
        .single()
      if (error || !created) {
        results[index] = { row_number: rowNumber, agent_code: agency.agent_code, owner_name: agency.owner_name, email: agency.email, status: 'failed', agency_id: null, error_message: error?.message ?? 'Insert failed' }
        continue
      }
      const agencyId = created.id as string

      if (agency.email || agency.business_phone || agency.mobile_phone) {
        await db.from('agency_owners').insert({
          agency_id: agencyId,
          full_name: agency.owner_name,
          email: agency.email,
          phone: agency.business_phone,
          mobile_phone: agency.mobile_phone,
        })
      }
      // Same activation + first-check-in side effects as the single-create route.
      await db.from('agency_activation').insert({ agency_id: agencyId, stage: 'identified' })
      await db.from('work_tasks').insert({
        title: `Initial check-in: ${agency.agency_name}`,
        entity_type: 'agency_partnership',
        entity_id: agencyId,
        source: 'workflow',
        due_at: new Date(Date.now() + 3 * 86400000).toISOString(),
        owner_scope: actor,
      })

      results[index] = { row_number: rowNumber, agent_code: agency.agent_code, owner_name: agency.owner_name, email: agency.email, status: 'success', agency_id: agencyId, error_message: null }
      importRecords.push({
        batch_id: batchId,
        entity_type: 'agency_partnership',
        raw,
        decision: { action: 'created', matchedBy: agency.agent_code ? ['agent_code'] : agency.email ? ['email'] : [] },
        target_id: agencyId,
        confidence: 'exact',
        review_status: 'auto',
        owner_scope: actor,
      })
    } catch (e) {
      results[index] = { row_number: rowNumber, agent_code: agency.agent_code, owner_name: agency.owner_name, email: agency.email, status: 'failed', agency_id: null, error_message: e instanceof Error ? e.message : 'Insert failed' }
    }
  }

  // Record every non-created row too (duplicate/invalid) for a complete trail.
  for (const r of results) {
    if (r.status === 'success') continue
    importRecords.push({
      batch_id: batchId,
      entity_type: 'agency_partnership',
      raw: rows[r.row_number - 1] ?? {},
      decision: { action: r.status, reason: r.error_message },
      confidence: 'none',
      review_status: r.status === 'invalid' ? 'needs_review' : 'skipped',
      owner_scope: actor,
    })
  }
  if (importRecords.length) await db.from('import_records').insert(importRecords)

  const counts = { success: 0, duplicate: 0, invalid: 0, failed: 0 }
  for (const r of results) counts[r.status]++

  await db.from('import_batches').update({ stats: { total_rows: rows.length, ...counts } }).eq('id', batchId)
  await writeAudit({ actor, action: 'import.committed', entity: 'import_batch', entityId: batchId, diff: { source: 'agency', filename: file.name, total: rows.length, counts } })

  return NextResponse.json({
    success: true,
    batch_id: batchId,
    filename: file.name,
    total: rows.length,
    counts,
    detected_columns: colMap,
    rows: results,
  })
}

// GET — recent agency-import history (batch list).
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const limit = parseLimit(req.nextUrl.searchParams.get('limit'), 15, 50)
  try {
    const { data, error } = await getDb()
      .from('import_batches')
      .select('id, filename, stats, actor, created_at')
      .eq('source', 'agency')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ batches: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load import history' }, { status: 500 })
  }
}
