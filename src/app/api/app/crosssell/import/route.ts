import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { parseContactsFile } from '@/lib/contacts/parseFile'
import { parseCrossSellTable, summarizeCrossSell, type CrossSellRecord } from '@/lib/import/crossSellList'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_ROWS = 20000
const CHUNK = 500

// Cross-Sell import (Auto/Home/Umbrella P&C book, No Life → life cross-sell targets).
// preview — parse + match against the Contact Center; NO writes.
// commit  — intelligent, idempotent sync into contacts:
//   • MATCH each row to an existing contact by, in priority order,
//     crosssell_key → email → phone → name+ZIP.
//   • MERGE a match in place, NEVER overwriting valid data: blank fields are
//     filled, tags + lines_of_business are unioned, contact_type is only
//     upgraded from 'unknown', compliance flags (DNC / unsub) are added.
//   • CREATE a 'cross_sell' contact when there is no match.
//   Re-running never duplicates (dedupe on crosssell_key). RBAC-gated + audited.
// GUARDRAILS: P&C lines only — is_security stays false; no product/policy advice.

interface ExistingContact {
  id: string
  full_name: string
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
  crosssell_key: string | null
}

const nameKey = (name: string) => (name || '').toLowerCase().replace(/[^a-z]/g, '')
const zip5of = (zip: string | null) => (zip || '').replace(/\D/g, '').slice(0, 5)

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a CSV, XLSX, or JSON file.' }, { status: 400 })
  }
  const file = formData.get('file')
  const mode = String(formData.get('mode') || 'preview')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'A non-empty file is required.' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'File exceeds the 12MB limit.' }, { status: 413 })

  let records: CrossSellRecord[]
  let skipped: number
  try {
    const table = await parseContactsFile(Buffer.from(await file.arrayBuffer()), file.name)
    const parsed = parseCrossSellTable(table)
    records = parsed.records
    skipped = parsed.skipped
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read the file.' }, { status: 422 })
  }
  if (records.length === 0) return NextResponse.json({ error: 'No usable rows found in the file.' }, { status: 400 })
  if (records.length > MAX_ROWS) return NextResponse.json({ error: `File has ${records.length} rows; the limit is ${MAX_ROWS}.` }, { status: 413 })

  const db = getDb()
  const actor = actorOf(auth.session)
  const summary = summarizeCrossSell(records)

  // Load the existing Contact Center once and index it for matching.
  let existing: ExistingContact[]
  try {
    existing = await loadAllContacts(db)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read contacts.' }, { status: 500 })
  }
  const byKey = new Map<string, ExistingContact>()
  const byEmail = new Map<string, ExistingContact>()
  const byPhone = new Map<string, ExistingContact>()
  const byNameZip = new Map<string, ExistingContact>()
  for (const c of existing) {
    if (c.crosssell_key && !byKey.has(c.crosssell_key)) byKey.set(c.crosssell_key, c)
    if (c.email_lc && !byEmail.has(c.email_lc)) byEmail.set(c.email_lc, c)
    if (c.phone_digits && !byPhone.has(c.phone_digits)) byPhone.set(c.phone_digits, c)
    const nz = `${nameKey(c.full_name)}|${zip5of(c.zip)}`
    if (!byNameZip.has(nz)) byNameZip.set(nz, c)
  }
  const matchOf = (r: CrossSellRecord): ExistingContact | null =>
    (r.crosssell_key && byKey.get(r.crosssell_key)) ||
    (r.email_lc && byEmail.get(r.email_lc)) ||
    (r.phone_digits && byPhone.get(r.phone_digits)) ||
    byNameZip.get(`${r.name_key}|${r.zip5}`) ||
    null

  // Classify each record → matched (enrich) vs new (insert). Dedupe new rows
  // within the file by crosssell_key so the same person listed twice inserts once.
  const enrich: Array<{ id: string; patch: Record<string, unknown> }> = []
  const seenNew = new Set<string>()
  const insertRows: Array<Record<string, unknown>> = []
  let matchedCount = 0
  let enrichChanged = 0
  let suppressedDupes = 0

  for (const r of records) {
    const m = matchOf(r)
    if (m) {
      matchedCount++
      const patch = buildMergePatch(m, r)
      if (Object.keys(patch).length > 0) {
        enrich.push({ id: m.id, patch })
        enrichChanged++
      }
    } else if (seenNew.has(r.crosssell_key)) {
      suppressedDupes++
    } else {
      seenNew.add(r.crosssell_key)
      insertRows.push(buildInsertRow(r, actor))
    }
  }

  const plan = {
    total_rows: records.length,
    skipped_rows: skipped,
    matched: matchedCount,
    new_contacts: insertRows.length,
    enrich_updates: enrichChanged,
    duplicate_rows_in_file: suppressedDupes,
  }

  if (mode !== 'commit') {
    return NextResponse.json({
      mode: 'preview',
      filename: file.name,
      summary,
      plan,
      sample: records.slice(0, 15).map((r) => ({
        full_name: r.full_name,
        lines_of_business: r.lines_of_business,
        city: r.city,
        state: r.state,
        zip: r.zip,
        phone: r.phone,
        email: r.email,
        matched: !!matchOf(r),
        dnc: r.phone_dnc,
        email_unsub: r.email_unsub,
      })),
    })
  }

  // ── COMMIT ──────────────────────────────────────────────────────────────
  try {
    // 1. Insert new cross-sell contacts.
    for (let i = 0; i < insertRows.length; i += CHUNK) {
      const { error } = await db.from('contacts').insert(insertRows.slice(i, i + CHUNK))
      if (error) throw new Error(`contacts insert failed: ${error.message}`)
    }
    // 2. Enrich matched contacts in place (no-overwrite patches).
    let updated = 0
    for (let i = 0; i < enrich.length; i += CHUNK) {
      const batch = enrich.slice(i, i + CHUNK)
      const results = await Promise.all(
        batch.map(({ id, patch }) => db.from('contacts').update(patch).eq('id', id).is('deleted_at', null)),
      )
      for (const res of results) {
        if (res.error) throw new Error(`contact enrich failed: ${res.error.message}`)
        updated++
      }
    }

    await writeAudit({
      actor,
      action: 'import.committed',
      entity: 'crosssell_list',
      entityId: null,
      diff: { filename: file.name, plan, dnc: summary.dnc, email_unsub: summary.email_unsub },
    })

    return NextResponse.json({
      mode: 'commit',
      filename: file.name,
      summary,
      plan,
      committed: { contacts_created: insertRows.length, contacts_enriched: updated },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Commit failed' }, { status: 500 })
  }
}

// ── merge / build ────────────────────────────────────────────────────────────

// Tags this record contributes: the cross-sell markers, its P&C lines (lower-
// cased), and compliance flags. Unioned with existing — never a replacement.
function tagsFor(r: CrossSellRecord): string[] {
  const t = ['cross-sell', 'no-life', 'pnc-book']
  for (const l of r.lines_of_business) t.push(l.toLowerCase())
  if (r.phone_dnc) t.push('dnc')
  if (r.email_unsub) t.push('email-unsubscribed')
  return t
}

// A no-overwrite patch: only blank fields are filled; tags + lines_of_business
// are unioned; contact_type is upgraded only from 'unknown'; crosssell_key is
// stamped if absent. Returns {} when nothing would change (idempotent re-runs).
function buildMergePatch(c: ExistingContact, r: CrossSellRecord): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const fillIfBlank = (col: keyof ExistingContact, val: string | null) => {
    if (val && !(c[col] as string | null)) patch[col] = val
  }
  fillIfBlank('email', r.email)
  fillIfBlank('phone', r.phone)
  fillIfBlank('address', r.street)
  fillIfBlank('city', r.city)
  fillIfBlank('state', r.state)
  fillIfBlank('zip', r.zip)
  if (r.email && !c.email_lc) patch.email_lc = r.email_lc
  if (r.phone && !c.phone_digits) patch.phone_digits = r.phone_digits

  const curTags = c.tags || []
  const mergedTags = Array.from(new Set([...curTags, ...tagsFor(r)]))
  if (mergedTags.length !== curTags.length) patch.tags = mergedTags

  const curLob = c.lines_of_business || []
  const mergedLob = Array.from(new Set([...curLob, ...r.lines_of_business]))
  if (mergedLob.length !== curLob.length) patch.lines_of_business = mergedLob

  if (c.contact_type === 'unknown') patch.contact_type = 'cross_sell'
  if (!c.crosssell_key) patch.crosssell_key = r.crosssell_key
  return patch
}

function buildInsertRow(r: CrossSellRecord, actor: string): Record<string, unknown> {
  return {
    crosssell_key: r.crosssell_key,
    full_name: r.full_name,
    first_name: r.first_name || null,
    last_name: r.last_name || null,
    contact_type: 'cross_sell',
    source: 'crosssell_pnc',
    status: 'active',
    created_by: actor,
    tags: tagsFor(r),
    lines_of_business: r.lines_of_business,
    email: r.email,
    email_lc: r.email_lc,
    phone: r.phone,
    phone_digits: r.phone_digits,
    address: r.street,
    city: r.city,
    state: r.state,
    zip: r.zip,
  }
}

// ── data load ────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadAllContacts(db: any): Promise<ExistingContact[]> {
  const cols = 'id, full_name, email, email_lc, phone, phone_digits, address, city, state, zip, contact_type, tags, lines_of_business, crosssell_key'
  const out: ExistingContact[] = []
  const page = 1000
  for (let offset = 0; offset < 200000; offset += page) {
    const { data, error } = await db.from('contacts').select(cols).is('deleted_at', null).range(offset, offset + page - 1)
    if (error) throw new Error(error.message)
    const rows = (data || []) as ExistingContact[]
    out.push(...rows)
    if (rows.length < page) break
  }
  return out
}
