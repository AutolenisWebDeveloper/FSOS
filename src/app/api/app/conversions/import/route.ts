import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { parseConversionFile, summarizeConversions, type ConversionRecord } from '@/lib/import/conversionList'
import { createBatch } from '@/lib/import/auditWriter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_ROWS = 20000
const CHUNK = 500

// Life Conversion import (FNWL term policies inside their conversion window).
// preview — parse + match each policy number against the book; NO writes.
// commit  — idempotent enrichment along the aggregate-root spine:
//   • POLICY: match household_policies by policy_number, set conversion_deadline
//     (only when blank — no valid data overwritten), fill product/face if blank,
//     and stash the conversion detail in source_data.
//   • CONTACT: tag the linked household's owner contact 'term-conversion' (create
//     it on the book provenance key if the book→contacts sync hasn't run yet, so
//     it never duplicates), upgrading an 'unknown' type to 'client'.
//   • MEMBER: ensure the named insured exists on the household (if different).
//   RBAC-gated + audited. GUARDRAILS: term products only — is_security stays
//   false and nothing recommends a conversion (green-zone identify).

interface ExistingPolicy {
  id: string
  policy_number: string
  household_id: string | null
  conversion_deadline: string | null
  product_name: string | null
  face_amount: number | string | null
  source_data: Record<string, unknown> | null
}
interface ExistingHousehold { id: string; book_owner_key: string | null; primary_name: string }
interface ExistingContact { id: string; book_key: string | null; contact_type: string; tags: string[] | null; household_id: string | null }

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with an XLSX, CSV, or PDF file.' }, { status: 400 })
  }
  const file = formData.get('file')
  const mode = String(formData.get('mode') || 'preview')
  const nowIso = String(formData.get('now') || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '2026-07-17'
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'A non-empty file is required.' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'File exceeds the 12MB limit.' }, { status: 413 })

  let records: ConversionRecord[]
  let skipped: number
  try {
    const parsed = await parseConversionFile(Buffer.from(await file.arrayBuffer()), file.name)
    records = parsed.records
    skipped = parsed.skipped
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read the file.' }, { status: 422 })
  }
  if (records.length === 0) return NextResponse.json({ error: 'No conversion rows found in the file.' }, { status: 400 })
  if (records.length > MAX_ROWS) return NextResponse.json({ error: `File has ${records.length} rows; the limit is ${MAX_ROWS}.` }, { status: 413 })

  const db = getDb()
  const actor = actorOf(auth.session)
  const summary = summarizeConversions(records, nowIso)

  // Match policies by policy_number.
  const policyNumbers = Array.from(new Set(records.map((r) => r.policy_number)))
  let policies: ExistingPolicy[]
  try {
    policies = await loadPolicies(db, policyNumbers)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read policies.' }, { status: 500 })
  }
  const policyByNumber = new Map(policies.map((p) => [p.policy_number, p]))
  const matched = records.filter((r) => policyByNumber.has(r.policy_number))
  const unmatched = records.filter((r) => !policyByNumber.has(r.policy_number))

  // Households behind the matched policies (for owner-contact provenance).
  const householdIds = Array.from(new Set(matched.map((r) => policyByNumber.get(r.policy_number)!.household_id).filter((x): x is string => !!x)))
  const households = await loadHouseholds(db, householdIds)
  const householdById = new Map(households.map((h) => [h.id, h]))

  const deadlinesToSet = matched.filter((r) => {
    const p = policyByNumber.get(r.policy_number)!
    return r.conversion_deadline && !p.conversion_deadline
  }).length

  const plan = {
    total_rows: records.length,
    skipped_rows: skipped,
    policies_matched: matched.length,
    policies_unmatched: unmatched.length,
    deadlines_to_set: deadlinesToSet,
    contacts_to_tag: householdIds.length,
  }

  if (mode !== 'commit') {
    return NextResponse.json({
      mode: 'preview',
      filename: file.name,
      summary,
      plan,
      unmatched: unmatched.slice(0, 20).map((r) => r.policy_number),
      sample: records.slice(0, 15).map((r) => ({
        policy_number: r.policy_number,
        owner: r.owner_name,
        insured: r.insured_name,
        product: r.product_type,
        convertible_amount: r.convertible_amount,
        conversion_deadline: r.conversion_deadline,
        matched: policyByNumber.has(r.policy_number),
      })),
    })
  }

  // ── COMMIT ──────────────────────────────────────────────────────────────
  try {
    // 1. Policy enrichment (no-overwrite).
    let policiesUpdated = 0
    const policyUpdates: Array<{ id: string; patch: Record<string, unknown> }> = []
    for (const r of matched) {
      const p = policyByNumber.get(r.policy_number)!
      const patch: Record<string, unknown> = {}
      if (r.conversion_deadline && !p.conversion_deadline) patch.conversion_deadline = r.conversion_deadline
      if (r.product_type && !p.product_name) patch.product_name = r.product_type
      if (r.convertible_amount != null && (p.face_amount == null || p.face_amount === '')) patch.face_amount = r.convertible_amount
      const conv = {
        source: 'conversion_list',
        convertible_amount: r.convertible_amount,
        product_type: r.product_type,
        insured: r.insured_name,
        insured_dob: r.insured_dob,
        inception_date: r.inception_date,
        expiration_date: r.expiration_date,
        conversion_deadline: r.conversion_deadline,
      }
      const existingData = (p.source_data && typeof p.source_data === 'object') ? p.source_data : {}
      patch.source_data = { ...existingData, conversion: conv }
      patch.is_with_us = true
      patch.is_security = false
      policyUpdates.push({ id: p.id, patch })
    }
    for (let i = 0; i < policyUpdates.length; i += CHUNK) {
      const batch = policyUpdates.slice(i, i + CHUNK)
      const results = await Promise.all(batch.map(({ id, patch }) => db.from('household_policies').update(patch).eq('id', id).is('deleted_at', null)))
      for (const res of results) { if (res.error) throw new Error(`policy enrich failed: ${res.error.message}`); policiesUpdated++ }
    }

    // 2. Owner contacts — tag term-conversion, keyed to the book provenance so a
    //    later book→contacts sync never duplicates them.
    const ownerBookKeys = households.filter((h) => h.book_owner_key).map((h) => `owner:${h.book_owner_key}`)
    const existingContacts = await loadContactsByBookKey(db, ownerBookKeys)
    const contactByKey = new Map(existingContacts.map((c) => [c.book_key!, c]))
    const contactInserts: Array<Record<string, unknown>> = []
    const contactPatches: Array<{ id: string; patch: Record<string, unknown> }> = []
    for (const h of households) {
      if (!h.book_owner_key) continue
      const key = `owner:${h.book_owner_key}`
      const existing = contactByKey.get(key)
      if (existing) {
        const tags = Array.from(new Set([...(existing.tags || []), 'term-conversion', 'fnwl-book']))
        const patch: Record<string, unknown> = {}
        if (tags.length !== (existing.tags || []).length) patch.tags = tags
        if (existing.contact_type === 'unknown') patch.contact_type = 'client'
        if (!existing.household_id) patch.household_id = h.id
        if (Object.keys(patch).length) contactPatches.push({ id: existing.id, patch })
      } else {
        const nm = h.primary_name.trim().split(/\s+/)
        contactInserts.push({
          book_key: key, full_name: h.primary_name, first_name: nm[0] || h.primary_name, last_name: nm.slice(1).join(' ') || null,
          contact_type: 'client', source: 'conversion_list', status: 'active', created_by: actor,
          tags: ['term-conversion', 'fnwl-book'], household_id: h.id,
        })
      }
    }
    for (let i = 0; i < contactInserts.length; i += CHUNK) {
      const { error } = await db.from('contacts').insert(contactInserts.slice(i, i + CHUNK))
      if (error) throw new Error(`contact insert failed: ${error.message}`)
    }
    let contactsTagged = 0
    for (let i = 0; i < contactPatches.length; i += CHUNK) {
      const results = await Promise.all(contactPatches.slice(i, i + CHUNK).map(({ id, patch }) => db.from('contacts').update(patch).eq('id', id).is('deleted_at', null)))
      for (const res of results) { if (res.error) throw new Error(`contact tag failed: ${res.error.message}`); contactsTagged++ }
    }

    // 3. Named insured → household member (when different from the owner).
    const desiredMembers: Array<{ household_id: string; full_name: string }> = []
    for (const r of matched) {
      const p = policyByNumber.get(r.policy_number)!
      if (!p.household_id || !r.insured_name) continue
      const h = householdById.get(p.household_id)
      if (h && r.insured_name.toLowerCase() !== h.primary_name.toLowerCase()) desiredMembers.push({ household_id: p.household_id, full_name: r.insured_name })
    }
    let membersAdded = 0
    if (desiredMembers.length) {
      const hids = Array.from(new Set(desiredMembers.map((m) => m.household_id)))
      const existingPairs = await loadMemberPairs(db, hids)
      const newMembers = desiredMembers
        .filter((m) => !existingPairs.has(`${m.household_id}|${m.full_name.toLowerCase()}`))
        .filter((m, i, a) => a.findIndex((x) => x.household_id === m.household_id && x.full_name.toLowerCase() === m.full_name.toLowerCase()) === i)
        .map((m) => ({ household_id: m.household_id, full_name: m.full_name, relationship: 'insured' }))
      for (let i = 0; i < newMembers.length; i += CHUNK) {
        const { error } = await db.from('household_members').insert(newMembers.slice(i, i + CHUNK))
        if (error) throw new Error(`member insert failed: ${error.message}`)
      }
      membersAdded = newMembers.length
    }

    const batchId = await createBatch(db, { source: 'conversion', filename: file.name, actor, stats: { plan, total_convertible: summary.total_convertible } })

    await writeAudit({ actor, action: 'import.committed', entity: 'conversion_list', entityId: batchId, diff: { filename: file.name, plan, total_convertible: summary.total_convertible } })

    return NextResponse.json({
      mode: 'commit',
      filename: file.name,
      summary,
      plan,
      committed: {
        policies_enriched: policiesUpdated,
        contacts_created: contactInserts.length,
        contacts_tagged: contactsTagged,
        members_added: membersAdded,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Commit failed' }, { status: 500 })
  }
}

// ── data load ────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPolicies(db: any, numbers: string[]): Promise<ExistingPolicy[]> {
  const out: ExistingPolicy[] = []
  for (let i = 0; i < numbers.length; i += CHUNK) {
    const { data, error } = await db.from('household_policies')
      .select('id, policy_number, household_id, conversion_deadline, product_name, face_amount, source_data')
      .in('policy_number', numbers.slice(i, i + CHUNK)).is('deleted_at', null)
    if (error) throw new Error(error.message)
    out.push(...((data || []) as ExistingPolicy[]))
  }
  return out
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadHouseholds(db: any, ids: string[]): Promise<ExistingHousehold[]> {
  const out: ExistingHousehold[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from('households').select('id, book_owner_key, primary_name').in('id', ids.slice(i, i + CHUNK)).is('deleted_at', null)
    if (error) throw new Error(error.message)
    out.push(...((data || []) as ExistingHousehold[]))
  }
  return out
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadContactsByBookKey(db: any, keys: string[]): Promise<ExistingContact[]> {
  const out: ExistingContact[] = []
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data, error } = await db.from('contacts').select('id, book_key, contact_type, tags, household_id').in('book_key', keys.slice(i, i + CHUNK)).is('deleted_at', null)
    if (error) throw new Error(error.message)
    out.push(...((data || []) as ExistingContact[]))
  }
  return out
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadMemberPairs(db: any, householdIds: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  for (let i = 0; i < householdIds.length; i += CHUNK) {
    const { data } = await db.from('household_members').select('household_id, full_name').in('household_id', householdIds.slice(i, i + CHUNK))
    for (const r of data || []) if (r.household_id && r.full_name) set.add(`${r.household_id}|${String(r.full_name).toLowerCase()}`)
  }
  return set
}
