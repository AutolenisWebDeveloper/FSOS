import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { parseLimit, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { parseSpreadsheet, extensionOf, SUPPORTED_EXTENSIONS } from '@/lib/spreadsheet'
import { mapAndValidateAgency, resolveAgencyColumns, type MappedAgency } from '@/lib/agencyDirectory'
import { buildContactIndex } from '@/lib/import/resolution'
import { loadContactCandidates } from '@/lib/import/auditWriter'
import { applyOwnerContactResolution, type AgencyOwnerContactInput } from '@/lib/services/agencyOwnerContact'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-02 Agency Directory bulk import → aggregate-root spine AND the unified
// Contact Center. Upload a Farmers agent directory (CSV/XLSX): each row creates
// (or backfills) an agency_partnership + owner, then the owner is reconciled into
// contacts through the shared, non-destructive resolution engine — merged into the
// right existing contact (filling missing address/phone/email, linking the agency
// so the agent number surfaces via the Book of Business) or created, with
// ambiguous matches routed to manual review. agency_owners.contact_id links the
// two representations. RBAC-gated (create = fsa/super), deduped, fully audited.
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_ROWS = 500

type PartnerStatus = 'success' | 'duplicate' | 'invalid' | 'failed'
type ContactStatus = 'created' | 'merged' | 'review' | 'skipped'

interface RowResult {
  row_number: number
  agent_code: string | null
  owner_name: string | null
  email: string | null
  status: PartnerStatus
  agency_id: string | null
  contact_status: ContactStatus | null
  contact_id: string | null
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
  const toProcess: Array<{ index: number; agency: MappedAgency }> = []
  const seen = new Set<string>()

  rows.forEach((record, i) => {
    const rowNumber = i + 1
    const { agency, errors } = mapAndValidateAgency(record, colMap, { state: defaultState })
    if (!agency) {
      results[i] = { row_number: rowNumber, agent_code: null, owner_name: null, email: null, status: 'invalid', agency_id: null, contact_status: null, contact_id: null, error_message: errors.join('; ') }
      return
    }
    if (seen.has(agency.dedupeKey)) {
      results[i] = { row_number: rowNumber, agent_code: agency.agent_code, owner_name: agency.owner_name, email: agency.email, status: 'duplicate', agency_id: null, contact_status: 'skipped', contact_id: null, error_message: `Duplicate of an earlier row (${agency.dedupeKey})` }
      return
    }
    seen.add(agency.dedupeKey)
    toProcess.push({ index: i, agency })
  })

  const db = getDb()
  const actor = actorOf(auth.session)

  // ── Existing-agency lookup (for backfill instead of skip) ──────────────────
  const existingByCode = new Map<string, string>() // agent_code(upper) → agency_id
  const existingByEmail = new Map<string, string>() // owner email(lower) → agency_id
  try {
    const codes = Array.from(new Set(toProcess.map((t) => t.agency.agent_code).filter((c): c is string => !!c)))
    const emails = Array.from(new Set(toProcess.map((t) => t.agency.email).filter((e): e is string => !!e)))
    if (codes.length) {
      const { data } = await db.from('agency_partnerships').select('id, fnwl_serving_agent_no').in('fnwl_serving_agent_no', codes).is('deleted_at', null)
      for (const r of data ?? []) if (r.fnwl_serving_agent_no) existingByCode.set(String(r.fnwl_serving_agent_no).toUpperCase(), r.id)
    }
    if (emails.length) {
      const { data } = await db.from('agency_owners').select('email, agency_id').in('email', emails)
      for (const r of data ?? []) if (r.email && r.agency_id) existingByEmail.set(String(r.email).toLowerCase(), r.agency_id)
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

  // ── Build the contact-resolution index once from the existing book ─────────
  const index = buildContactIndex(await loadContactCandidates(db))
  const importRecords: Array<Record<string, unknown>> = []

  // ── Process each row: partnership → owner → contact reconciliation ─────────
  for (const { index: rowIndex, agency } of toProcess) {
    const rowNumber = rowIndex + 1
    const raw = rows[rowIndex]
    try {
      // 1. Resolve the agency_partnership (existing → backfill; else create).
      const codeKey = agency.agent_code ? agency.agent_code.toUpperCase() : null
      const emailKeyLc = agency.email ? agency.email.toLowerCase() : null
      let agencyId = (codeKey && existingByCode.get(codeKey)) || (emailKeyLc && existingByEmail.get(emailKeyLc)) || null
      let partnerStatus: PartnerStatus = agencyId ? 'duplicate' : 'success'

      if (!agencyId) {
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
          results[rowIndex] = { row_number: rowNumber, agent_code: agency.agent_code, owner_name: agency.owner_name, email: agency.email, status: 'failed', agency_id: null, contact_status: null, contact_id: null, error_message: error?.message ?? 'Insert failed' }
          continue
        }
        agencyId = created.id as string
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
        // Newly created → make it available for same-batch email/code dedupe.
        if (codeKey) existingByCode.set(codeKey, agencyId)
        if (emailKeyLc) existingByEmail.set(emailKeyLc, agencyId)
      }

      // 2. Ensure an agency_owners row (holds email/phones; link target).
      const ownerId = await getOrCreateOwner(db, agencyId, agency)

      // 3. Reconcile the owner into the Contact Center via the shared engine.
      const contactInput: AgencyOwnerContactInput = {
        agencyId,
        agentCode: agency.agent_code,
        ownerName: agency.owner_name,
        email: agency.email,
        businessPhone: agency.business_phone,
        mobilePhone: agency.mobile_phone,
        address: agency.office_address,
        city: agency.office_city,
        state: agency.office_state,
        zip: agency.office_zip,
      }
      const applied = await applyOwnerContactResolution(db, index, contactInput, actor)
      const contactStatus: ContactStatus = applied.status
      const contactId = applied.contactId

      // 4. Link the owner record to its reconciled contact.
      if (ownerId && contactId) await db.from('agency_owners').update({ contact_id: contactId }).eq('id', ownerId)

      results[rowIndex] = { row_number: rowNumber, agent_code: agency.agent_code, owner_name: agency.owner_name, email: agency.email, status: partnerStatus, agency_id: agencyId, contact_status: contactStatus, contact_id: contactId, error_message: partnerStatus === 'duplicate' ? 'Agency already on file — contact backfilled.' : null }

      // Partnership audit record.
      importRecords.push({ batch_id: batchId, entity_type: 'agency_partnership', raw, decision: { action: partnerStatus === 'success' ? 'created' : 'backfilled', matchedBy: codeKey && existingByCode.has(codeKey) ? ['agent_code'] : emailKeyLc ? ['email'] : [] }, target_id: agencyId, confidence: 'exact', review_status: 'auto', owner_scope: actor })
      // Contact reconciliation record (also populates the manual-review queue).
      importRecords.push({ batch_id: batchId, entity_type: 'contact', raw, decision: { action: applied.resolution.action, matchedBy: applied.resolution.matchedBy, conflict: applied.resolution.conflict, candidateIds: applied.resolution.candidateIds }, target_id: contactId, merged_fields: applied.mergedFields, rejected_values: applied.rejectedValues, confidence: applied.resolution.confidence, review_status: contactStatus === 'review' ? 'needs_review' : 'auto', owner_scope: actor })
    } catch (e) {
      results[rowIndex] = { row_number: rowNumber, agent_code: agency.agent_code, owner_name: agency.owner_name, email: agency.email, status: 'failed', agency_id: null, contact_status: null, contact_id: null, error_message: e instanceof Error ? e.message : 'Insert failed' }
    }
  }

  // Record invalid/in-file-duplicate rows too, for a complete trail.
  for (const r of results) {
    if (r.status === 'invalid' || (r.status === 'duplicate' && r.agency_id === null)) {
      importRecords.push({ batch_id: batchId, entity_type: 'agency_partnership', raw: rows[r.row_number - 1] ?? {}, decision: { action: r.status, reason: r.error_message }, confidence: 'none', review_status: r.status === 'invalid' ? 'needs_review' : 'skipped', owner_scope: actor })
    }
  }
  if (importRecords.length) {
    const CHUNK = 500
    for (let i = 0; i < importRecords.length; i += CHUNK) await db.from('import_records').insert(importRecords.slice(i, i + CHUNK))
  }

  const counts = { success: 0, duplicate: 0, invalid: 0, failed: 0 }
  const contactCounts = { created: 0, merged: 0, review: 0, skipped: 0 }
  for (const r of results) {
    counts[r.status]++
    if (r.contact_status) contactCounts[r.contact_status]++
  }

  await db.from('import_batches').update({ stats: { total_rows: rows.length, ...counts, contacts: contactCounts } }).eq('id', batchId)
  await writeAudit({ actor, action: 'import.committed', entity: 'import_batch', entityId: batchId, diff: { source: 'agency', filename: file.name, total: rows.length, counts, contacts: contactCounts } })

  return NextResponse.json({
    success: true,
    batch_id: batchId,
    filename: file.name,
    total: rows.length,
    counts,
    contacts: contactCounts,
    detected_columns: colMap,
    rows: results,
  })
}

/** Find the agency's owner row (prefer an email match), else create it. Returns the owner id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOrCreateOwner(db: any, agencyId: string, agency: MappedAgency): Promise<string | null> {
  let q = db.from('agency_owners').select('id').eq('agency_id', agencyId)
  if (agency.email) q = q.eq('email', agency.email)
  const { data: found } = await q.limit(1)
  if (found && found[0]) return found[0].id
  const { data: ins } = await db
    .from('agency_owners')
    .insert({ agency_id: agencyId, full_name: agency.owner_name, email: agency.email, phone: agency.business_phone, mobile_phone: agency.mobile_phone })
    .select('id')
    .single()
  return ins?.id ?? null
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
