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
import { materializeContact, type MaterializableContact } from '@/lib/services/householdMaterialize'
import { resolveConsentGroup, selectableChannels, isConsentGroupKey } from '@/lib/comms/consent-groups'
import { grantConsentForGroup, type GrantConsentForGroupResult } from '@/lib/comms/consent-group-grant-run'
import { buildCommitPlan, extractRowExtras, signatureHash, detectTemplate, squashHeader, type HeaderDecision, type RowExtras } from '@/lib/import/mapping'
import { saveTemplate, rememberHeaderDecisions, ensureCustomFields } from '@/lib/import/mapping/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

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

  // Confirmed field mapping (design spec v2.1). When the mapper UI sends an
  // operator-reviewed header_map, we apply it (composite splits, custom values,
  // plain DOB, LOB tags, joint owner) instead of auto-recognition — and remember
  // it for next time. Absent this, the route behaves exactly as before.
  const mappingRaw = String(formData.get('mapping') || '').trim()
  const saveTemplateFlag = String(formData.get('save_template') || 'true').trim().toLowerCase() !== 'false'
  const templateName = String(formData.get('template_name') || '').trim()
  let confirmedMap: Record<string, HeaderDecision> | null = null
  if (mappingRaw) {
    try {
      confirmedMap = JSON.parse(mappingRaw) as Record<string, HeaderDecision>
    } catch {
      return NextResponse.json({ error: 'The confirmed field mapping was not valid JSON.', reason: 'bad_mapping' }, { status: 422 })
    }
  }

  // Optional consent-group assignment (§12/TCPA). If the operator attaches a group, the
  // system generates the member-keyed `consents` rows for the imported contacts instead of
  // opening each one by hand — but ONLY on an explicit attestation that the batch already
  // has prior express consent (this is a legal assertion the licensed operator owns, not a
  // silent blanket grant). A group without the attestation is rejected. Suppression (a later
  // opt-out) is still enforced downstream, so a grant can never re-consent someone who
  // opted out.
  const consentGroupKeyRaw = String(formData.get('consent_group') || '').trim()
  const consentAttested = String(formData.get('consent_attest') || '').trim().toLowerCase() === 'true'
  const consentChannelsRaw = String(formData.get('consent_channels') || '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
  let consentGroup = null as ReturnType<typeof resolveConsentGroup>
  let consentChannels: ('sms' | 'email')[] = []
  if (consentGroupKeyRaw) {
    if (!isConsentGroupKey(consentGroupKeyRaw)) {
      return NextResponse.json({ error: 'Unknown consent group.', reason: 'bad_consent_group' }, { status: 422 })
    }
    if (!consentAttested) {
      return NextResponse.json(
        { error: 'To assign a consent group you must confirm these contacts have already provided prior express consent for the selected channels.', reason: 'consent_attestation_required' },
        { status: 422 },
      )
    }
    consentGroup = resolveConsentGroup(consentGroupKeyRaw)
    consentChannels = selectableChannels(consentGroup!, consentChannelsRaw)
    if (consentChannels.length === 0) {
      return NextResponse.json({ error: 'Select at least one channel (SMS or email) for the consent group.', reason: 'no_consent_channel' }, { status: 422 })
    }
    // The group's tag rides along on every imported contact so the assignment is visible on
    // the record (unioned with any operator-supplied tags — never a replace).
    if (!batchTags.includes(consentGroup!.tag)) batchTags.push(consentGroup!.tag)
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
    return NextResponse.json({ error: 'The file has no data rows to import.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `File has ${rows.length} rows; the limit is ${MAX_ROWS}. Split it into smaller files.` }, { status: 413 })
  }

  // Column resolution: confirmed operator mapping (mapper UI) OR auto-recognition.
  const commitPlan = confirmedMap ? buildCommitPlan(headers, confirmedMap) : null
  let colMap: Record<string, CanonicalField>
  let detectionMethod: Record<string, string> | string
  let aiResult: Awaited<ReturnType<typeof aiDetectColumns>> = null
  if (commitPlan) {
    colMap = commitPlan.colMap
    detectionMethod = 'confirmed'
  } else {
    aiResult = useAi ? await aiDetectColumns(headers, rows) : null
    const resolved = resolveColumns(headers, rows, aiResult?.map)
    colMap = resolved.map
    detectionMethod = resolved.method
  }
  const mapped = new Set(Object.values(colMap))
  const hasName = mapped.has('first_name') || mapped.has('last_name') || mapped.has('full_name')
  const hasContact = mapped.has('email') || mapped.has('phone')
  // Confirmed mappings require a name column; a per-row contact point is still
  // enforced downstream (rows without email/phone are quarantined + reported, not
  // dropped). Auto-recognition additionally requires a contact column up front.
  if (!hasName || (!commitPlan && !hasContact)) {
    return NextResponse.json({ error: 'Could not recognize the required columns. Need a name and at least one of email or phone.', detected_columns: colMap, detection_method: commitPlan ? 'confirmed' : (aiResult ? 'ai' : 'header'), headers }, { status: 422 })
  }

  // Per-row extras the legacy mapper doesn't carry (address block, plain DOB,
  // custom values, LOB tags, joint owner). Empty when no confirmed mapping.
  const extrasByIndex = new Map<number, RowExtras>()
  if (commitPlan) {
    rows.forEach((record, i) => extrasByIndex.set(i, extractRowExtras(record, commitPlan)))
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
    const { data } = await db.from('contacts').select('id, full_name, first_name, last_name, email, email_lc, phone, phone_digits, tags, contact_type, address, city, state, zip, dob, custom').in('id', mergeIds.slice(i, i + CHUNK)).is('deleted_at', null)
    for (const r of data || []) existingById.set(r.id as string, r)
  }

  const records: Omit<RecordInput, 'batchId'>[] = []
  const ownerScope = auth.session.userId ?? null

  // 1. MERGE — no-overwrite; union tags; capture rejected values for the audit.
  const MERGE_SPEC = [
    { field: 'email' }, { field: 'email_lc' }, { field: 'phone' }, { field: 'phone_digits' },
    { field: 'first_name' }, { field: 'last_name' }, { field: 'tags', kind: 'set' as const },
    { field: 'address' }, { field: 'city' }, { field: 'state' }, { field: 'zip' }, { field: 'dob' },
  ]
  for (const p of toMerge) {
    const ex = existingById.get(p.res.targetId!) || {}
    const x = extrasByIndex.get(p.index)
    const incoming: Record<string, unknown> = {
      email: p.contact.email, email_lc: emailLc(p.contact.email),
      phone: p.contact.phone, phone_digits: phoneDigits(p.contact.phone),
      first_name: p.contact.firstName || null, last_name: p.contact.lastName || null,
      tags: Array.from(new Set([...p.contact.tags, ...batchTags, ...(x?.extraTags ?? [])])),
      // Address block + plain DOB — no-overwrite fill from the confirmed mapping.
      address: x?.address ?? null, city: x?.city ?? null, state: x?.state ?? null, zip: x?.zip ?? null, dob: x?.dob ?? null,
    }
    const { patch, merged, rejected } = mergeFields(ex, incoming, MERGE_SPEC)
    if (ex.contact_type === 'unknown' && (p.contact.declaredType && p.contact.declaredType !== 'unknown')) {
      patch.contact_type = p.contact.declaredType
      merged.push('contact_type')
    }
    // Custom values: union into existing custom jsonb without overwriting a set key.
    if (x && Object.keys(x.custom).length) {
      const exCustom = (ex.custom as Record<string, unknown>) || {}
      const nextCustom = { ...exCustom }
      let changed = false
      for (const [k, v] of Object.entries(x.custom)) if (!(k in nextCustom)) { nextCustom[k] = v; changed = true }
      if (changed) { patch.custom = nextCustom; merged.push('custom') }
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
  // Joint owners (spec §6): a create row carrying a joint owner seeds a SECOND
  // contact sharing the household. Collected here, inserted + materialized after
  // the primaries so they group under the same household origin key.
  const jointInsertRows: Array<Record<string, unknown>> = []
  const insertRows = toCreate.map((p, k) => {
    const c = p.contact
    const x = extrasByIndex.get(p.index)
    const type: ContactType = (useRouting ? classify.classifications[k]?.type : null) ?? 'unknown'
    const route = routeForType(type)
    const tags = Array.from(new Set([...c.tags, ...(useRouting ? route.tags : []), ...(x?.extraTags ?? [])]))
    if (useRouting) routeCounts[type] = (routeCounts[type] || 0) + 1
    results[p.index] = { row_number: p.index + 1, full_name: c.label, email: c.email, phone: c.phone, status: 'imported', contact_type: type, error_message: null }
    records.push({ entityType: 'contact', raw: rows[p.index], decision: { ...p.res }, confidence: 'none', reviewStatus: 'auto', ownerScope })
    if (x?.joint) {
      jointInsertRows.push({
        full_name: x.joint.full_name, phone: x.joint.phone, phone_digits: phoneDigits(x.joint.phone),
        contact_type: 'unknown', tags, source: c.source, status: 'active', owner_scope: ownerScope, created_by: actor,
        address: x.joint.address ?? x?.address ?? null, city: x.joint.city ?? x?.city ?? null,
        ...(x.joint.state ?? x?.state ? { state: x.joint.state ?? x?.state } : {}),
        zip: x.joint.zip ?? x?.zip ?? null, custom: x.joint.custom,
      })
    }
    return {
      first_name: c.firstName || null, last_name: c.lastName || null, full_name: c.label,
      email: c.email, email_lc: emailLc(c.email), phone: c.phone, phone_digits: phoneDigits(c.phone),
      contact_type: type, tags, source: c.source, status: 'active', owner_scope: ownerScope, created_by: actor,
      address: x?.address ?? null, city: x?.city ?? null, ...(x?.state ? { state: x.state } : {}), zip: x?.zip ?? null,
      dob: x?.dob ?? null, custom: x?.custom ?? {},
    }
  })
  let materialized = 0
  const memberIdsForConsent: string[] = []
  if (insertRows.length) {
    const { data: inserted, error } = await db
      .from('contacts')
      .insert(insertRows)
      .select('id, full_name, first_name, last_name, email, phone, address, city, state, zip, contact_type, agency_partnership_id, owner_scope')
    if (error) return NextResponse.json({ error: `Import failed on write: ${error.message}` }, { status: 500 })
    // Slice 3 — materialize each new contact into the household spine so it is
    // campaign-enrollable (the native engine enrolls household_members). Idempotent
    // and best-effort per contact: a failure is counted, never fails the import.
    for (const c of (inserted ?? []) as MaterializableContact[]) {
      const r = await materializeContact(db, c)
      if (r.householdId && r.action !== 'error') materialized++
      if (consentGroup && r.memberId && r.action !== 'error') memberIdsForConsent.push(r.memberId)
    }
  }

  // Joint owners → distinct contacts sharing the household (spec §6). Insert after
  // the primaries and materialize so they land in the same household by origin key.
  let jointCreated = 0
  if (jointInsertRows.length) {
    const { data: jointInserted } = await db
      .from('contacts')
      .insert(jointInsertRows)
      .select('id, full_name, first_name, last_name, email, phone, address, city, state, zip, contact_type, agency_partnership_id, owner_scope')
    for (const c of (jointInserted ?? []) as MaterializableContact[]) {
      const r = await materializeContact(db, c)
      if (r.action !== 'error') jointCreated++
    }
  }

  // Merged rows matched an EXISTING contact — they belong to the batch/group too, so seed
  // their members as well (idempotent + suppression-aware, so an already-consented or
  // opted-out member is a safe no-op). Resolve the members of the merged target contacts.
  if (consentGroup && toMerge.length) {
    const mergedContactIds = Array.from(new Set(toMerge.map((p) => p.res.targetId!).filter(Boolean)))
    for (let i = 0; i < mergedContactIds.length; i += CHUNK) {
      const { data: mm } = await db
        .from('household_members')
        .select('id')
        .in('source_contact_id', mergedContactIds.slice(i, i + CHUNK))
      for (const m of (mm ?? []) as { id: string }[]) memberIdsForConsent.push(m.id)
    }
  }

  // Consent-group generation (§12/TCPA). Turn the imported members into member-keyed
  // `consents` rows for the attested group + channels. The runner is idempotent and
  // suppression-aware (an existing revoke / channel DNC / do_not_contact household always
  // wins), writes the group's documented disclosure onto every row, and audits each grant.
  // Best-effort: a consent-write failure surfaces in the response but never fails the
  // contact import (the contacts are already durably stored).
  let consentReport: (GrantConsentForGroupResult & { error?: string }) | null = null
  if (consentGroup && memberIdsForConsent.length) {
    try {
      consentReport = await grantConsentForGroup({ memberIds: memberIdsForConsent, group: consentGroup, channels: consentChannels, actor })
    } catch (e) {
      consentReport = { membersProcessed: memberIdsForConsent.length, smsCreated: 0, emailCreated: 0, skippedAlreadyGranted: 0, skippedRevoked: 0, skippedDnc: 0, skippedHouseholdDnc: 0, groupKey: consentGroup.key, source: consentGroup.source, channels: consentChannels, capturedAt: new Date().toISOString(), error: e instanceof Error ? e.message : 'Consent generation failed' }
    }
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

  // Mapping memory (spec §5): remember every confirmed header decision globally,
  // register any new custom fields, and save/refresh the template for this file
  // signature so the next file of the same shape auto-maps. All best-effort — a
  // memory-write failure never fails the import (contacts are already stored).
  let templateSaved = false
  let customFieldsCreated = 0
  if (confirmedMap && commitPlan) {
    const memEntries = headers
      .map((h) => ({ squashed: squashHeader(h), sampleHeader: h, decision: confirmedMap![squashHeader(h)] }))
      .filter((e) => e.squashed && e.decision)
    await rememberHeaderDecisions(db, memEntries)
    customFieldsCreated = await ensureCustomFields(db, commitPlan.requiredCustomFields, actor)
    if (saveTemplateFlag) {
      const tmpl = detectTemplate(headers)
      await saveTemplate(db, { signature: signatureHash(headers), name: templateName || tmpl?.name || file.name, templateKey: tmpl?.key ?? null, headerMap: confirmedMap, actor })
      templateSaved = true
    }
  }

  await writeAudit({ actor, action: 'import.committed', entity: 'contacts_import', entityId: null, diff: { filename: file.name, format: ext || 'csv', total: rows.length, counts, mapping: confirmedMap ? { confirmed: true, template_saved: templateSaved, custom_fields_created: customFieldsCreated, joint_created: jointCreated } : null, routing: useRouting ? routeCounts : null, consent_group: consentGroup ? { group: consentGroup.key, channels: consentChannels, attested: true, sms_created: consentReport?.smsCreated ?? 0, email_created: consentReport?.emailCreated ?? 0 } : null } })

  return NextResponse.json({
    success: true,
    filename: file.name,
    format: ext || 'csv',
    total: rows.length,
    counts,
    households_materialized: materialized,
    joint_created: jointCreated,
    detection_method: detectionMethod,
    mapping: confirmedMap ? { confirmed: true, template_saved: templateSaved, custom_fields_created: customFieldsCreated } : null,
    ai_used: !!aiResult,
    batch_id: batchId,
    routing: { enabled: useRouting, ai_used: classify.aiUsed, counts: routeCounts, capped: classify.aiCapped },
    consent: consentReport
      ? {
          group: consentReport.groupKey,
          channels: consentReport.channels,
          members: consentReport.membersProcessed,
          sms_created: consentReport.smsCreated,
          email_created: consentReport.emailCreated,
          skipped_already_granted: consentReport.skippedAlreadyGranted,
          skipped_opted_out: consentReport.skippedRevoked + consentReport.skippedDnc + consentReport.skippedHouseholdDnc,
          error: consentReport.error ?? null,
        }
      : null,
    rows: results,
  })
}
