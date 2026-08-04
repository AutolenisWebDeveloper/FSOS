import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { parseConversionFile, summarizeConversions, planConversionCreates, conversionOwnerKey, type ConversionRecord, type ConversionCreatePlan } from '@/lib/import/conversionList'
import { createBatch } from '@/lib/import/auditWriter'
import { emailLc, phoneDigits } from '@/lib/contacts/normalize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_ROWS = 20000
const CHUNK = 500

// Life Conversion import (FNWL term policies inside their conversion window).
// preview — parse + match each policy number against the book; NO writes.
// commit  — idempotent load + enrichment along the aggregate-root spine:
//   ── matched rows (policy already on the book) ──
//   • POLICY: set conversion_deadline (only when blank — no valid data
//     overwritten), fill product/face if blank, stash conversion detail.
//   • CONTACT: tag the owner contact 'term-conversion' (create on the book
//     provenance key if the book→contacts sync hasn't run yet, so it never
//     duplicates), upgrading an 'unknown' type to 'client'.
//   • MEMBER: ensure the named insured exists on the household (if different).
//   ── unmatched rows (policy NOT yet on the book) ──
//   • ORIGINATE the household (book_owner_key, dedupe-shared with the In-Force
//     Book importer), the policy (source_system='fnwl' → policy-number unique
//     index dedupes on re-run), the owner contact, and the named insured. So a
//     single upload loads the whole conversion list, not only rows already in
//     the book. Re-running matches those policies and changes nothing further.
//   RBAC-gated + audited. GUARDRAILS: term products only — is_security is set
//   from the product (variable → firewalled) and nothing recommends a
//   conversion (green-zone identify).

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
interface ExistingContact { id: string; book_key: string | null; contact_type: string; tags: string[] | null; household_id: string | null; email: string | null; phone: string | null }

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

  // Owner contact points behind each household (first non-empty across its
  // policies) — the District export carries a preferred email + phone we use to
  // make the term-conversion owner contact reachable. Storing (not sending) has
  // no consent implication; the §12 dispatcher still gates any outreach.
  const contactInfoByHousehold = new Map<string, { email: string | null; phone: string | null }>()
  for (const r of matched) {
    const hid = policyByNumber.get(r.policy_number)!.household_id
    if (!hid) continue
    const cur = contactInfoByHousehold.get(hid) || { email: null, phone: null }
    if (!cur.email && r.preferred_email) cur.email = r.preferred_email
    if (!cur.phone && r.preferred_phone) cur.phone = r.preferred_phone
    contactInfoByHousehold.set(hid, cur)
  }

  const deadlinesToSet = matched.filter((r) => {
    const p = policyByNumber.get(r.policy_number)!
    return r.conversion_deadline && !p.conversion_deadline
  }).length

  // Unmatched rows become NEW book records. Load which owner households already
  // exist (a prior partial import) so we never re-create one.
  const unmatchedOwnerKeys = Array.from(new Set(unmatched.map((r) => r.owner_name).filter(Boolean).map(conversionOwnerKey)))
  let existingHouseholdKeys: Set<string>
  try {
    existingHouseholdKeys = await loadExistingHouseholdKeys(db, unmatchedOwnerKeys)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read households.' }, { status: 500 })
  }
  const createPlan: ConversionCreatePlan = planConversionCreates(unmatched, existingHouseholdKeys)
  const unmatchedNoOwner = unmatched.filter((r) => !r.owner_name).length

  const plan = {
    total_rows: records.length,
    skipped_rows: skipped,
    policies_matched: matched.length,
    policies_unmatched: unmatched.length,
    deadlines_to_set: deadlinesToSet,
    contacts_to_tag: householdIds.length,
    households_to_create: createPlan.households.length,
    policies_to_create: createPlan.policies.length,
    rows_without_owner: unmatchedNoOwner,
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
        email: r.preferred_email,
        phone: r.preferred_phone,
        agent_of_record: r.agent_of_record,
        matched: policyByNumber.has(r.policy_number),
      })),
    })
  }

  // ── COMMIT ──────────────────────────────────────────────────────────────
  try {
    // 0. ORIGINATE unmatched rows on the spine (households → policies → owner
    //    contacts → insured members). Keyed so a re-run (now matched) is a no-op
    //    and a later In-Force Book import converges on the same household.
    let householdsCreated = 0
    let policiesCreated = 0
    let originatedContacts = 0
    let originatedMembers = 0
    if (createPlan.households.length || createPlan.policies.length) {
      // 0a. New households.
      const newHouseholdRows = createPlan.households.map((h) => ({ book_owner_key: h.book_owner_key, primary_name: h.primary_name }))
      for (let i = 0; i < newHouseholdRows.length; i += CHUNK) {
        const { error } = await db.from('households').insert(newHouseholdRows.slice(i, i + CHUNK))
        if (error) throw new Error(`household create failed: ${error.message}`)
      }
      householdsCreated = newHouseholdRows.length

      // 0b. Resolve book_owner_key → household_id for every policy's household
      //     (newly created OR pre-existing).
      const policyOwnerKeys = Array.from(new Set(createPlan.policies.map((p) => p.book_owner_key)))
      const householdIdByKey = await mapHouseholdIds(db, policyOwnerKeys)

      // 0c. New policies (FNWL provenance → policy-number unique index dedupes).
      const newPolicyRows = createPlan.policies
        .map((p) => {
          const hid = householdIdByKey.get(p.book_owner_key)
          if (!hid) return null
          return {
            household_id: hid,
            policy_number: p.policy_number,
            product_name: p.product_name,
            // Denormalized {{PolicyType}} label — the imported product name is the human-readable type.
            policy_type: p.product_name,
            status: 'active',
            is_with_us: true,
            is_security: p.is_security,
            face_amount: p.face_amount,
            effective_date: p.effective_date,
            expiration_date: p.expiration_date,
            conversion_deadline: p.conversion_deadline,
            source_system: 'fnwl',
            source_data: p.source_data,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
      for (let i = 0; i < newPolicyRows.length; i += CHUNK) {
        const { error } = await db.from('household_policies').insert(newPolicyRows.slice(i, i + CHUNK))
        if (error) throw new Error(`policy create failed: ${error.message}`)
      }
      policiesCreated = newPolicyRows.length

      // 0d. Owner contacts for the new households (term-conversion), keyed on the
      //     book provenance so the book→contacts sync never duplicates them.
      const newHhKeys = createPlan.households.map((h) => `owner:${h.book_owner_key}`)
      const alreadyContacts = await loadContactsByBookKey(db, newHhKeys)
      const haveContactKey = new Set(alreadyContacts.map((c) => c.book_key!))
      const originatedContactRows = createPlan.households
        .filter((h) => !haveContactKey.has(`owner:${h.book_owner_key}`))
        .map((h) => {
          const hid = householdIdByKey.get(h.book_owner_key) ?? null
          const nm = h.primary_name.trim().split(/\s+/)
          return {
            book_key: `owner:${h.book_owner_key}`, full_name: h.primary_name, first_name: nm[0] || h.primary_name, last_name: nm.slice(1).join(' ') || null,
            contact_type: 'client', source: 'conversion_list', status: 'active', created_by: actor,
            tags: ['term-conversion', 'fnwl-book'], household_id: hid,
            email: h.owner_email, email_lc: emailLc(h.owner_email), phone: h.owner_phone, phone_digits: phoneDigits(h.owner_phone),
          }
        })
      for (let i = 0; i < originatedContactRows.length; i += CHUNK) {
        const { error } = await db.from('contacts').insert(originatedContactRows.slice(i, i + CHUNK))
        if (error) throw new Error(`contact create failed: ${error.message}`)
      }
      originatedContacts = originatedContactRows.length

      // 0e. Named insureds → household members (idempotent per household).
      const memberRows: Array<{ household_id: string; full_name: string; relationship: string }> = []
      for (const h of createPlan.households) {
        const hid = householdIdByKey.get(h.book_owner_key)
        if (!hid) continue
        for (const name of h.insured_names) memberRows.push({ household_id: hid, full_name: name, relationship: 'insured' })
      }
      if (memberRows.length) {
        const hids = Array.from(new Set(memberRows.map((m) => m.household_id)))
        const existingPairs = await loadMemberPairs(db, hids)
        const toInsert = memberRows.filter((m) => !existingPairs.has(`${m.household_id}|${m.full_name.toLowerCase()}`))
        for (let i = 0; i < toInsert.length; i += CHUNK) {
          const { error } = await db.from('household_members').insert(toInsert.slice(i, i + CHUNK))
          if (error) throw new Error(`member create failed: ${error.message}`)
        }
        originatedMembers = toInsert.length
      }
    }

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
        preferred_email: r.preferred_email,
        preferred_phone: r.preferred_phone,
        agent_of_record: r.agent_of_record,
        aor_code: r.aor_code,
      }
      const existingData = (p.source_data && typeof p.source_data === 'object') ? p.source_data : {}
      patch.source_data = { ...existingData, conversion: conv }
      // Promote AOR code to the first-class column so Global Search resolves it (§11).
      if (r.aor_code) patch.aor_code = r.aor_code
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
      const info = contactInfoByHousehold.get(h.id) || { email: null, phone: null }
      const existing = contactByKey.get(key)
      if (existing) {
        const tags = Array.from(new Set([...(existing.tags || []), 'term-conversion', 'fnwl-book']))
        const patch: Record<string, unknown> = {}
        if (tags.length !== (existing.tags || []).length) patch.tags = tags
        if (existing.contact_type === 'unknown') patch.contact_type = 'client'
        if (!existing.household_id) patch.household_id = h.id
        // Fill contact points only when blank — never overwrite existing data.
        if (!existing.email && info.email) { patch.email = info.email; patch.email_lc = emailLc(info.email) }
        if (!existing.phone && info.phone) { patch.phone = info.phone; patch.phone_digits = phoneDigits(info.phone) }
        if (Object.keys(patch).length) contactPatches.push({ id: existing.id, patch })
      } else {
        const nm = h.primary_name.trim().split(/\s+/)
        contactInserts.push({
          book_key: key, full_name: h.primary_name, first_name: nm[0] || h.primary_name, last_name: nm.slice(1).join(' ') || null,
          contact_type: 'client', source: 'conversion_list', status: 'active', created_by: actor,
          tags: ['term-conversion', 'fnwl-book'], household_id: h.id,
          email: info.email, email_lc: emailLc(info.email), phone: info.phone, phone_digits: phoneDigits(info.phone),
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
        policies_created: policiesCreated,
        households_created: householdsCreated,
        policies_enriched: policiesUpdated,
        contacts_created: contactInserts.length + originatedContacts,
        contacts_tagged: contactsTagged,
        members_added: membersAdded + originatedMembers,
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
// Which of these book_owner_keys already have a household (never re-create one).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadExistingHouseholdKeys(db: any, keys: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data, error } = await db.from('households').select('book_owner_key').in('book_owner_key', keys.slice(i, i + CHUNK)).is('deleted_at', null)
    if (error) throw new Error(error.message)
    for (const r of data || []) if (r.book_owner_key != null) set.add(String(r.book_owner_key))
  }
  return set
}
// Map book_owner_key → household id (for linking originated policies/contacts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mapHouseholdIds(db: any, keys: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data, error } = await db.from('households').select('id, book_owner_key').in('book_owner_key', keys.slice(i, i + CHUNK)).is('deleted_at', null)
    if (error) throw new Error(error.message)
    for (const r of data || []) if (r.book_owner_key != null) map.set(String(r.book_owner_key), String(r.id))
  }
  return map
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
    const { data, error } = await db.from('contacts').select('id, book_key, contact_type, tags, household_id, email, phone').in('book_key', keys.slice(i, i + CHUNK)).is('deleted_at', null)
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
