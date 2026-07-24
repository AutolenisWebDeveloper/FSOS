import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { parseConversionFile, summarizeConversions, conversionAorHints, conversionSuppressions, deriveConversionSpine, conversionOwnerKey, type ConversionRecord, type SuppressionChannel } from '@/lib/import/conversionList'
import { createBatch } from '@/lib/import/auditWriter'
import { existingKeys, existingPairs, insertChunked, mapIds, mapIdsByLowerName } from '@/lib/import/spine'
import { emailLc, phoneDigits } from '@/lib/contacts/normalize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_ROWS = 20000
const CHUNK = 500

// Life Conversion import (FNWL term policies inside their conversion window).
// The list mixes clients already on the book with clients not yet in FSOS, so the
// commit is CREATE-OR-ENRICH: matched policies are enriched, unmatched policies
// create the full spine (agency → household → members → policy → owner contact),
// resolving each owner to an existing household first so nothing duplicates.
// preview — parse + match each policy number against the book; NO writes.
// commit  — idempotent create-or-enrich along the aggregate-root spine:
//   • POLICY: match household_policies by policy_number, set conversion_deadline
//     (only when blank — no valid data overwritten), fill product/face if blank,
//     stash the conversion detail in source_data, and backfill the Agent-of-Record
//     hints ('Serving Agent Number' = series code, 'Agency Name') so the AOR
//     resolver trigger links agency_partnership_id (only when unset — never
//     overwrites a good one).
//   • CONTACT: tag the linked household's owner contact 'term-conversion' (create
//     it on the book provenance key if the book→contacts sync hasn't run yet, so
//     it never duplicates), upgrading an 'unknown' type to 'client'.
//   • MEMBER: ensure the named insured exists on the household (if different).
//   • DNC: honor the file's channel opt-outs — write dnc_entries per contact+channel
//     (DNC→call, PWC-Revoked→sms, Unsubscribed/Held→email) and hard-flag a matched
//     litigator's household do_not_contact, so the §12 dispatcher never auto-sends.
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

  // Agent-of-Record hints: rows carrying a series code / agency name that the
  // household_policies resolver (fsos_resolve_policy_agency) can link.
  const aorHinted = matched.filter((r) => Object.keys(conversionAorHints(r)).length > 0).length

  // Do-not-contact ledger entries derived from the channel indicators (every row,
  // matched or not — an opt-out must be honored regardless of book membership).
  const suppressionPlan = buildSuppressions(records)

  // Clients NOT yet on the book → create them (agency → household → members →
  // policy → owner contact). Resolve each unmatched owner to an existing household
  // first (by provenance key, then by name) so we never duplicate a client already
  // in FSOS under a different policy.
  const spine = deriveConversionSpine(unmatched)
  const spineSeries = spine.agencies.map((a) => a.series_code)
  const spineHhKeys = spine.households.map((h) => h.book_owner_key)
  const spineOwnerNames = spine.households.map((h) => h.owner_name)
  let existingAgencySeries: Set<string>, existingHhByKey: Set<string>, existingHhByName: Map<string, string>
  try {
    ;[existingAgencySeries, existingHhByKey, existingHhByName] = await Promise.all([
      existingKeys(db, 'agency_partnerships', 'fnwl_serving_agent_no', spineSeries),
      existingKeys(db, 'households', 'book_owner_key', spineHhKeys),
      mapIdsByLowerName(db, 'households', 'primary_name', 'id', spineOwnerNames),
    ])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read existing records.' }, { status: 500 })
  }
  const newAgencies = spine.agencies.filter((a) => !existingAgencySeries.has(a.series_code))
  const newHouseholds = spine.households.filter((h) => !existingHhByKey.has(h.book_owner_key) && !existingHhByName.has(h.owner_name.toLowerCase()))

  const plan = {
    total_rows: records.length,
    skipped_rows: skipped,
    policies_matched: matched.length,
    policies_unmatched: unmatched.length,
    deadlines_to_set: deadlinesToSet,
    contacts_to_tag: householdIds.length,
    aor_hints_to_apply: aorHinted,
    dnc_entries_to_write: suppressionPlan.entries.length,
    litigators_flagged: suppressionPlan.litigatorContacts.size,
    suppressions_by_channel: suppressionPlan.byChannel,
    create: {
      new_clients: newHouseholds.length,
      new_policies: spine.policies.length,
      new_agencies: newAgencies.length,
    },
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
        agent_of_record: r.agency_name || r.series_code || null,
        do_not_contact: conversionSuppressions(r).map((s) => s.channel),
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
      // AOR hints backfill source_data (existing keys win — never overwrite a good
      // one); the BEFORE-UPDATE trigger resolves agency_partnership_id when unset.
      const aor = conversionAorHints(r)
      patch.source_data = { ...aor, ...existingData, conversion: conv }
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
      const memberPairs = await loadMemberPairs(db, hids)
      const newMembers = desiredMembers
        .filter((m) => !memberPairs.has(`${m.household_id}|${m.full_name.toLowerCase()}`))
        .filter((m, i, a) => a.findIndex((x) => x.household_id === m.household_id && x.full_name.toLowerCase() === m.full_name.toLowerCase()) === i)
        .map((m) => ({ household_id: m.household_id, full_name: m.full_name, relationship: 'insured' }))
      for (let i = 0; i < newMembers.length; i += CHUNK) {
        const { error } = await db.from('household_members').insert(newMembers.slice(i, i + CHUNK))
        if (error) throw new Error(`member insert failed: ${error.message}`)
      }
      membersAdded = newMembers.length
    }

    // 3b. Create clients not yet on the book (unmatched policies) along the whole
    //     spine: agency → household → members → policy → owner contact. Idempotent
    //     (re-running finds them matched and enriches instead). The policy's
    //     source_data carries the AOR hints so the trigger links agency + owner.
    let agenciesCreated = 0, householdsCreated = 0, policiesCreated = 0, membersCreatedNew = 0, ownerContactsCreated = 0
    if (spine.policies.length) {
      // Agencies (serving-agent series not yet a partnership).
      const newAgencyRows = newAgencies.map((a) => ({ fnwl_serving_agent_no: a.series_code, agency_name: a.agency_name, owner_name: a.agency_name, status: 'producing' }))
      await insertChunked(db, 'agency_partnerships', newAgencyRows)
      agenciesCreated = newAgencyRows.length
      const agencyIdBySeries = await mapIds(db, 'agency_partnerships', 'fnwl_serving_agent_no', 'id', spineSeries)

      // Households (owner not resolvable to an existing one by key or name).
      const newHouseholdRows = newHouseholds.map((h) => ({
        book_owner_key: h.book_owner_key, primary_name: h.owner_name, state: 'TX',
        referring_agency_id: h.series_code ? agencyIdBySeries.get(h.series_code) ?? null : null,
      }))
      await insertChunked(db, 'households', newHouseholdRows)
      householdsCreated = newHouseholdRows.length
      const createdKeys = new Set(newHouseholds.map((h) => h.book_owner_key))

      const hidByKey = await mapIds(db, 'households', 'book_owner_key', 'id', spineHhKeys)
      const ownerNameByKey = new Map(spine.households.map((h) => [h.book_owner_key, h.owner_name]))
      const resolveHid = (key: string): string | null => hidByKey.get(key) ?? existingHhByName.get((ownerNameByKey.get(key) || '').toLowerCase()) ?? null

      // Policies (BEFORE-INSERT trigger resolves agency_partnership_id + contact_id).
      const policyRows = spine.policies.map((p) => {
        const hid = resolveHid(p.book_owner_key)
        if (!hid) return null
        const aor = conversionAorHints(p)
        return {
          household_id: hid, policy_number: p.policy_number, product_name: p.product_type,
          face_amount: p.convertible_amount, conversion_deadline: p.conversion_deadline, status: 'active',
          is_with_us: true, is_security: false, source_system: 'conversion_list',
          source_data: { ...aor, conversion: { source: 'conversion_list', convertible_amount: p.convertible_amount, product_type: p.product_type, insured: p.insured_name, insured_dob: p.insured_dob, inception_date: p.inception_date, expiration_date: p.expiration_date, conversion_deadline: p.conversion_deadline } },
        }
      }).filter((r): r is NonNullable<typeof r> => r !== null)
      await insertChunked(db, 'household_policies', policyRows)
      policiesCreated = policyRows.length

      // Members (owner + insured), idempotent per household.
      const desiredSpineMembers = spine.members.map((m) => ({ household_id: resolveHid(m.book_owner_key), full_name: m.full_name, relationship: m.relationship })).filter((m): m is { household_id: string; full_name: string; relationship: 'owner' | 'insured' } => !!m.household_id)
      const spineMemberHids = Array.from(new Set(desiredSpineMembers.map((m) => m.household_id)))
      const existingSpinePairs = await existingPairs(db, 'household_members', 'household_id', 'full_name', spineMemberHids)
      const seenMember = new Set<string>()
      const newSpineMembers = desiredSpineMembers.filter((m) => {
        const k = `${m.household_id}|${m.full_name.toLowerCase()}`
        if (existingSpinePairs.has(k) || seenMember.has(k)) return false
        seenMember.add(k); return true
      })
      await insertChunked(db, 'household_members', newSpineMembers)
      membersCreatedNew = newSpineMembers.length

      // Owner contacts — only for households we created (existing ones already have
      // their contact); keyed owner:<book_owner_key> so nothing duplicates.
      const ownerContactRows = spine.ownerContacts.filter((c) => createdKeys.has(c.book_owner_key)).map((c) => {
        const nm = c.owner_name.trim().split(/\s+/)
        return { book_key: `owner:${c.book_owner_key}`, full_name: c.owner_name, first_name: nm[0] || c.owner_name, last_name: nm.slice(1).join(' ') || null, contact_type: 'client', source: 'conversion_list', status: 'active', created_by: actor, tags: ['term-conversion', 'fnwl-book'], email: c.email, email_lc: emailLc(c.email), phone: c.phone, phone_digits: phoneDigits(c.phone), household_id: hidByKey.get(c.book_owner_key) ?? null }
      })
      const existingOwnerContacts = await existingKeys(db, 'contacts', 'book_key', ownerContactRows.map((r) => r.book_key))
      const newOwnerContacts = ownerContactRows.filter((r) => !existingOwnerContacts.has(r.book_key))
      await insertChunked(db, 'contacts', newOwnerContacts)
      ownerContactsCreated = newOwnerContacts.length
    }

    // 4. Do-not-contact ledger — honor the file's channel opt-outs so the §12
    //    dispatcher never auto-contacts an opted-out recipient. Fail-closed and
    //    member-free: dnc_entries key on the raw contact string + channel; a known
    //    litigator additionally hard-flags its matched household do_not_contact.
    let dncWritten = 0
    if (suppressionPlan.entries.length) {
      for (let i = 0; i < suppressionPlan.entries.length; i += CHUNK) {
        const { error } = await db.from('dnc_entries').upsert(suppressionPlan.entries.slice(i, i + CHUNK), { onConflict: 'contact,channel' })
        if (error) throw new Error(`dnc write failed: ${error.message}`)
      }
      dncWritten = suppressionPlan.entries.length
    }
    let householdsDncFlagged = 0
    if (suppressionPlan.litigatorContacts.size) {
      const litigatorHouseholds = new Set<string>()
      for (const r of matched) {
        if (!r.pni_phone) continue
        if (suppressionPlan.litigatorContacts.has(r.pni_phone.trim())) {
          const hid = policyByNumber.get(r.policy_number)!.household_id
          if (hid) litigatorHouseholds.add(hid)
        }
      }
      const hids = Array.from(litigatorHouseholds)
      for (let i = 0; i < hids.length; i += CHUNK) {
        const results = await Promise.all(hids.slice(i, i + CHUNK).map((id) => db.from('households').update({ do_not_contact: true }).eq('id', id).is('deleted_at', null)))
        for (const res of results) { if (res.error) throw new Error(`household DNC flag failed: ${res.error.message}`); householdsDncFlagged++ }
      }
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
        dnc_entries_written: dncWritten,
        households_dnc_flagged: householdsDncFlagged,
        agencies_created: agenciesCreated,
        clients_created: householdsCreated,
        policies_created: policiesCreated,
        spine_members_created: membersCreatedNew,
        owner_contacts_created: ownerContactsCreated,
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
/**
 * Dedupe the file's channel opt-outs into dnc_entries rows (one per contact+channel),
 * the set of litigator contacts (for household hard-flagging), and per-channel counts.
 */
function buildSuppressions(records: ConversionRecord[]): {
  entries: Array<{ contact: string; channel: SuppressionChannel; scope: string; reason: string }>
  litigatorContacts: Set<string>
  byChannel: Record<string, number>
} {
  const byKey = new Map<string, { contact: string; channel: SuppressionChannel; scope: string; reason: string }>()
  const litigatorContacts = new Set<string>()
  const byChannel: Record<string, number> = {}
  for (const r of records) {
    for (const s of conversionSuppressions(r)) {
      if (s.litigator) litigatorContacts.add(s.contact.trim())
      const key = `${s.contact}|${s.channel}`
      if (!byKey.has(key)) {
        byKey.set(key, { contact: s.contact, channel: s.channel, scope: 'external', reason: s.reason })
        byChannel[s.channel] = (byChannel[s.channel] || 0) + 1
      }
    }
  }
  return { entries: Array.from(byKey.values()), litigatorContacts, byChannel }
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
