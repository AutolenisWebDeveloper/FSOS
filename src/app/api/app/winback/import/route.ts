import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { parseWinBackFile, summarizeWinBack, type WinBackRecord } from '@/lib/import/winBackList'
import { buildContactIndex, resolveContact, mergeFields } from '@/lib/import/resolution'
import { createBatch, writeRecords, loadContactCandidates, type RecordInput } from '@/lib/import/auditWriter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_ROWS = 20000
const CHUNK = 500

// Win-Back Life import (households whose agency once had a Life line, now lapsed
// → life re-engagement targets). Uses the SAME universal entity-resolution engine
// every importer shares, so matching / merging / dedup / audit / review behave
// identically regardless of file source or format.
//
// preview — parse + resolve each row against the whole Contact Center; NO writes.
// commit  — intelligent, idempotent sync:
//   • MATCH each row by, in priority order, winback_key (provenance) → email →
//     phone → name+ZIP, using the shared resolver.
//   • MERGE a reliable match in place, NEVER overwriting valid data: blank fields
//     fill, tags + lines_of_business union, contact_type is only upgraded from
//     'unknown', winback_key is stamped, and the book-of-business agency owner is
//     linked only when the contact has none. Rejected values are recorded.
//   • REVIEW — a name-only or conflicting match is queued (never guessed) so a
//     human resolves it from the Import Review queue.
//   • CREATE a new 'prospect' contact when there is no match.
//   Optionally assigns a selected agent/agency (agency_partnership_id) as the
//   owner of the entire imported book. Re-running never duplicates (dedupe on
//   winback_key). RBAC-gated + fully audited (import_batches + import_records).
// GUARDRAILS: green-zone "identify" only — is_security stays false; no advice.

interface ExistingContact {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  email: string | null
  email_lc: string | null
  phone: string | null
  phone_digits: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  contact_type: string
  tags: string[] | null
  lines_of_business: string[] | null
  winback_key: string | null
  agency_partnership_id: string | null
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a CSV, XLSX, PDF, or JSON file.' }, { status: 400 })
  }
  const file = formData.get('file')
  const mode = String(formData.get('mode') || 'preview')
  const ownerAgencyId = String(formData.get('agency_partnership_id') || '').trim() || null
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'A non-empty file is required.' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'File exceeds the 12MB limit.' }, { status: 413 })

  let records: WinBackRecord[]
  let skipped: number
  try {
    const parsed = await parseWinBackFile(Buffer.from(await file.arrayBuffer()), file.name)
    records = parsed.records
    skipped = parsed.skipped
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read the file.' }, { status: 422 })
  }
  if (records.length === 0) return NextResponse.json({ error: 'No usable rows found in the file.' }, { status: 400 })
  if (records.length > MAX_ROWS) return NextResponse.json({ error: `File has ${records.length} rows; the limit is ${MAX_ROWS}.` }, { status: 413 })

  const db = getDb()
  const actor = actorOf(auth.session)
  const ownerScope = auth.session.userId ?? null
  const summary = summarizeWinBack(records)

  // Validate the selected book-of-business owner (agency partnership), if any.
  let ownerAgency: { id: string; agency_name: string | null } | null = null
  if (ownerAgencyId) {
    const { data, error } = await db.from('agency_partnerships').select('id, agency_name').eq('id', ownerAgencyId).is('deleted_at', null).maybeSingle()
    if (error) return NextResponse.json({ error: `Could not verify the selected agency: ${error.message}` }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'The selected owning agency was not found.' }, { status: 400 })
    ownerAgency = data as { id: string; agency_name: string | null }
  }

  // Resolve every row against the whole Contact Center with the shared engine.
  const index = buildContactIndex(await loadContactCandidates(db))
  const resolutions = records.map((r) => ({
    r,
    res: resolveContact(index, { provenanceKeys: [r.winback_key], email: r.email, phone: r.phone, fullName: r.full_name, zip: r.zip }),
  }))

  // In-file dedupe on winback_key for the CREATE set (same person listed twice
  // inserts once); merges/reviews are per existing-record so they don't collide.
  const toMerge = resolutions.filter((x) => x.res.action === 'merge' && x.res.targetId)
  const toReview = resolutions.filter((x) => x.res.action === 'review' || (x.res.action === 'merge' && !x.res.targetId))
  const seenNew = new Set<string>()
  const toCreate: typeof resolutions = []
  let suppressedDupes = 0
  for (const x of resolutions.filter((y) => y.res.action === 'create')) {
    if (seenNew.has(x.r.winback_key)) { suppressedDupes++; continue }
    seenNew.add(x.r.winback_key)
    toCreate.push(x)
  }

  // Full current rows for the merge targets (no-overwrite needs existing values).
  const mergeIds = Array.from(new Set(toMerge.map((x) => x.res.targetId!)))
  const existingById = new Map<string, ExistingContact>()
  for (let i = 0; i < mergeIds.length; i += CHUNK) {
    const { data } = await db.from('contacts')
      .select('id, full_name, first_name, last_name, email, email_lc, phone, phone_digits, address, city, state, zip, contact_type, tags, lines_of_business, winback_key, agency_partnership_id')
      .in('id', mergeIds.slice(i, i + CHUNK)).is('deleted_at', null)
    for (const r of (data || []) as ExistingContact[]) existingById.set(r.id, r)
  }

  const plan = {
    total_rows: records.length,
    skipped_rows: skipped,
    had_life: summary.had_life,
    matched_merge: toMerge.length,
    needs_review: toReview.length,
    new_contacts: toCreate.length,
    duplicate_rows_in_file: suppressedDupes,
    owner_agency: ownerAgency ? ownerAgency.agency_name : null,
  }

  if (mode !== 'commit') {
    return NextResponse.json({
      mode: 'preview',
      filename: file.name,
      summary,
      plan,
      sample: resolutions.slice(0, 15).map((x) => ({
        full_name: x.r.full_name,
        inactive_lob: x.r.inactive_lob,
        active_lob: x.r.active_lob,
        state: x.r.state,
        zip: x.r.zip,
        phone: x.r.phone,
        email: x.r.email,
        had_life: x.r.had_life,
        dnc: x.r.phone_dnc,
        email_unsub: x.r.email_unsub,
        action: x.res.action,
        confidence: x.res.confidence,
        matched_by: x.res.matchedBy,
      })),
    })
  }

  // ── COMMIT ──────────────────────────────────────────────────────────────
  const auditRecords: Omit<RecordInput, 'batchId'>[] = []
  const MERGE_SPEC = [
    { field: 'email' }, { field: 'email_lc' }, { field: 'phone' }, { field: 'phone_digits' },
    { field: 'first_name' }, { field: 'last_name' }, { field: 'address' }, { field: 'city' },
    { field: 'state' }, { field: 'zip' },
    { field: 'tags', kind: 'set' as const }, { field: 'lines_of_business', kind: 'set' as const },
  ]

  try {
    // 1. MERGE — no-overwrite; union tags + LOB; owner-link only if blank.
    let merged = 0
    for (const x of toMerge) {
      const ex = existingById.get(x.res.targetId!)
      if (!ex) continue
      const incoming: Record<string, unknown> = {
        email: x.r.email, email_lc: x.r.email_lc, phone: x.r.phone, phone_digits: x.r.phone_digits,
        first_name: x.r.first_name || null, last_name: x.r.last_name || null,
        address: null, city: null, state: x.r.state, zip: x.r.zip,
        tags: Array.from(new Set([...(ex.tags || []), ...tagsFor(x.r)])),
        lines_of_business: Array.from(new Set([...(ex.lines_of_business || []), ...x.r.lines_of_business])),
      }
      const { patch, merged: mfields, rejected } = mergeFields(ex as unknown as Record<string, unknown>, incoming, MERGE_SPEC)
      if (ex.contact_type === 'unknown') { patch.contact_type = 'prospect'; mfields.push('contact_type') }
      if (!ex.winback_key) { patch.winback_key = x.r.winback_key; mfields.push('winback_key') }
      // Book-of-business owner: link only when the contact has none (preserve
      // any existing valid relationship; record a differing owner as rejected).
      if (ownerAgency) {
        if (!ex.agency_partnership_id) { patch.agency_partnership_id = ownerAgency.id; mfields.push('agency_partnership_id') }
        else if (ex.agency_partnership_id !== ownerAgency.id) rejected.push({ field: 'agency_partnership_id', existing: ex.agency_partnership_id, incoming: ownerAgency.id })
      }
      if (Object.keys(patch).length) {
        const { error } = await db.from('contacts').update(patch).eq('id', ex.id).is('deleted_at', null)
        if (error) throw new Error(`contact merge failed: ${error.message}`)
        merged++
      }
      auditRecords.push({ entityType: 'contact', raw: rawOf(x.r), decision: { ...x.res }, targetId: ex.id, mergedFields: mfields, rejectedValues: rejected, confidence: x.res.confidence, reviewStatus: 'auto', ownerScope })
    }

    // 2. REVIEW — never write; queue with full context so a human resolves it.
    for (const x of toReview) {
      const incoming = {
        full_name: x.r.full_name, first_name: x.r.first_name || null, last_name: x.r.last_name || null,
        email: x.r.email, email_lc: x.r.email_lc, phone: x.r.phone, phone_digits: x.r.phone_digits,
        contact_type: 'prospect', tags: tagsFor(x.r), lines_of_business: x.r.lines_of_business,
        address: null, city: null, state: x.r.state, zip: x.r.zip,
        agency_partnership_id: ownerAgency ? ownerAgency.id : null, source: 'winback_life',
      }
      auditRecords.push({ entityType: 'contact', raw: rawOf(x.r), decision: { ...x.res, incoming }, targetId: x.res.targetId, confidence: x.res.confidence, reviewStatus: 'needs_review', ownerScope })
    }

    // 3. CREATE — insert new prospect contacts (green-zone identify).
    const insertRows = toCreate.map((x) => buildInsertRow(x.r, actor, ownerScope, ownerAgency?.id ?? null))
    for (let i = 0; i < insertRows.length; i += CHUNK) {
      const { error } = await db.from('contacts').insert(insertRows.slice(i, i + CHUNK))
      if (error) throw new Error(`contacts insert failed: ${error.message}`)
    }
    for (const x of toCreate) auditRecords.push({ entityType: 'contact', raw: rawOf(x.r), decision: { ...x.res }, confidence: 'none', reviewStatus: 'auto', ownerScope })

    // Audit trail: one batch + one record per imported row.
    const batchId = await createBatch(db, { source: 'winback', filename: file.name, actor, ownerScope, stats: { plan, summary } })
    if (batchId) await writeRecords(db, auditRecords.map((r) => ({ ...r, batchId })))

    await writeAudit({
      actor,
      action: 'import.committed',
      entity: 'winback_list',
      entityId: batchId,
      diff: { filename: file.name, plan, owner_agency_id: ownerAgency?.id ?? null, dnc: summary.dnc, email_unsub: summary.email_unsub },
    })

    return NextResponse.json({
      mode: 'commit',
      filename: file.name,
      summary,
      plan,
      committed: {
        contacts_created: insertRows.length,
        contacts_enriched: merged,
        queued_for_review: toReview.length,
      },
      batch_id: batchId,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Commit failed' }, { status: 500 })
  }
}

// ── merge / build ────────────────────────────────────────────────────────────

// Tags this record contributes: the win-back markers, its lines of business
// (lower-cased), and compliance flags. Unioned with existing — never a replace.
function tagsFor(r: WinBackRecord): string[] {
  const t = ['win-back']
  if (r.had_life) t.push('life-winback')
  for (const l of r.lines_of_business) t.push(l.toLowerCase())
  if (r.phone_dnc) t.push('dnc')
  if (r.email_unsub) t.push('email-unsubscribed')
  return t
}

function buildInsertRow(r: WinBackRecord, actor: string, ownerScope: string | null, agencyId: string | null): Record<string, unknown> {
  return {
    winback_key: r.winback_key,
    full_name: r.full_name,
    first_name: r.first_name || null,
    last_name: r.last_name || null,
    contact_type: 'prospect',
    source: 'winback_life',
    status: 'active',
    created_by: actor,
    owner_scope: ownerScope,
    agency_partnership_id: agencyId,
    tags: tagsFor(r),
    lines_of_business: r.lines_of_business,
    email: r.email,
    email_lc: r.email_lc,
    phone: r.phone,
    phone_digits: r.phone_digits,
    state: r.state,
    zip: r.zip,
  }
}

// The original imported row, captured verbatim for the audit trail.
function rawOf(r: WinBackRecord): Record<string, unknown> {
  return {
    full_name: r.full_name,
    inactive_lob: r.inactive_lob,
    active_lob: r.active_lob,
    had_life: r.had_life,
    state: r.state,
    zip: r.zip,
    phone: r.phone,
    email: r.email,
    phone_dnc: r.phone_dnc,
    email_unsub: r.email_unsub,
  }
}
