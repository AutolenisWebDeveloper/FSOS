import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { parseInforceBook, summarizeBook, type InforcePolicy } from '@/lib/import/inforceBook'
import { emailLc, phoneDigits } from '@/lib/contacts/normalize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_ROWS = 20000
const CHUNK = 500

// In-Force Book import (FNWL district review → App B aggregate root + Contacts).
// preview — parse + summarize + count new-vs-existing per entity; NO writes.
// commit  — idempotent load (select existing keys → insert only new):
//   serving agents  → agency_partnerships
//   owners          → households (+ owner/insured/joint members)
//   policies        → household_policies (variable → is_security)
//   every person    → contacts (owner/joint = client, agent = agency_owner),
//                     linked to household + agency, so the Contact Center is the
//                     populated, synchronized source of truth.
// Re-running adds nothing (dedupe on provenance keys). RBAC-gated + audited.
function splitName(full: string): { first: string; last: string } {
  const parts = String(full || '').trim().split(/\s+/)
  return { first: parts[0] || full || '', last: parts.slice(1).join(' ') }
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
    return NextResponse.json({ error: 'Expected multipart/form-data with an .xlsx file.' }, { status: 400 })
  }
  const file = formData.get('file')
  const mode = String(formData.get('mode') || 'preview')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'A non-empty .xlsx file is required.' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'File exceeds the 12MB limit.' }, { status: 413 })

  let parsed
  try {
    parsed = await parseInforceBook(Buffer.from(await file.arrayBuffer()))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read the file.' }, { status: 422 })
  }
  if (parsed.policies.length === 0) return NextResponse.json({ error: 'No policy rows found in the file.' }, { status: 400 })
  if (parsed.policies.length > MAX_ROWS) return NextResponse.json({ error: `File has ${parsed.policies.length} policies; the limit is ${MAX_ROWS}.` }, { status: 413 })

  const db = getDb()
  const actor = actorOf(auth.session)
  const summary = summarizeBook(parsed)

  // Distinct entities.
  const agents = new Map<string, string>() // agent_no → name
  const households = new Map<string, InforcePolicy>() // book_owner_key → representative row
  const joints = new Map<string, InforcePolicy>() // joint_owner_key → representative row
  const policyByNumber = new Map<string, InforcePolicy>()
  for (const p of parsed.policies) {
    if (p.serving_agent_no) agents.set(p.serving_agent_no, p.serving_agent_name || p.serving_agent_no)
    if (!households.has(p.book_owner_key)) households.set(p.book_owner_key, p)
    if (p.joint_owner_key && !joints.has(p.joint_owner_key)) joints.set(p.joint_owner_key, p)
    if (!policyByNumber.has(p.policy_number)) policyByNumber.set(p.policy_number, p)
  }
  const agentNos = Array.from(agents.keys())
  const ownerKeys = Array.from(households.keys())
  const policyNumbers = Array.from(policyByNumber.keys())

  // Contact book_keys: owner:/joint:/agent: — one contact per distinct person.
  const contactBookKeys = [
    ...ownerKeys.map((k) => `owner:${k}`),
    ...Array.from(joints.keys()).map((k) => `joint:${k}`),
    ...agentNos.map((n) => `agent:${n}`),
  ]

  const existingAgentSet = await existingKeys(db, 'agency_partnerships', 'fnwl_serving_agent_no', agentNos)
  const existingHhSet = await existingKeys(db, 'households', 'book_owner_key', ownerKeys)
  const existingPolSet = await existingKeys(db, 'household_policies', 'policy_number', policyNumbers, true)
  const existingContactSet = await existingKeys(db, 'contacts', 'book_key', contactBookKeys)

  const plan = {
    serving_agents: { in_file: agents.size, existing: existingAgentSet.size, new: agents.size - existingAgentSet.size },
    households: { in_file: households.size, existing: existingHhSet.size, new: households.size - existingHhSet.size },
    policies: { in_file: policyByNumber.size, existing: existingPolSet.size, new: policyByNumber.size - existingPolSet.size },
    contacts: { in_file: contactBookKeys.length, existing: existingContactSet.size, new: contactBookKeys.length - existingContactSet.size },
  }

  if (mode !== 'commit') {
    return NextResponse.json({
      mode: 'preview',
      filename: file.name,
      summary: { ...summary, joint_owners: joints.size },
      plan,
      sample: parsed.policies.slice(0, 15).map((p) => ({ policy_number: p.policy_number, product_name: p.product_name, status: p.status, is_security: p.is_security, owner_name: p.owner_name, serving_agent_name: p.serving_agent_name })),
    })
  }

  // ── COMMIT ──────────────────────────────────────────────────────────────
  try {
    // 1. Serving agents → agency_partnerships.
    const newAgencyRows = agentNos.filter((no) => !existingAgentSet.has(no)).map((no) => ({ fnwl_serving_agent_no: no, agency_name: agents.get(no)!, owner_name: agents.get(no)!, status: 'producing' }))
    await insertChunked(db, 'agency_partnerships', newAgencyRows)
    const agencyId = await mapIds(db, 'agency_partnerships', 'fnwl_serving_agent_no', 'id', agentNos)

    // 2. Owners → households.
    const newHouseholdKeys = ownerKeys.filter((k) => !existingHhSet.has(k))
    const newHouseholdRows = newHouseholdKeys.map((k) => {
      const p = households.get(k)!
      return { book_owner_key: k, primary_name: p.owner_name, address: p.owner_address, city: p.owner_city, state: (p.owner_state || 'TX').slice(0, 2), zip: (p.owner_zip || '').slice(0, 10) || null, referring_agency_id: p.serving_agent_no ? agencyId.get(p.serving_agent_no) ?? null : null }
    })
    await insertChunked(db, 'households', newHouseholdRows)
    const householdId = await mapIds(db, 'households', 'book_owner_key', 'id', ownerKeys)

    // 3. Members (owner + insured + joint) — idempotent across all households.
    const desiredMembers: Array<{ household_id: string; full_name: string; relationship: string; phone: string | null }> = []
    for (const p of Array.from(households.values())) {
      const hid = householdId.get(p.book_owner_key)
      if (!hid) continue
      desiredMembers.push({ household_id: hid, full_name: p.owner_name, relationship: 'owner', phone: p.owner_phone })
      if (p.insured_name && p.insured_name.trim().toLowerCase() !== p.owner_name.trim().toLowerCase()) desiredMembers.push({ household_id: hid, full_name: p.insured_name, relationship: 'insured', phone: null })
      if (p.joint_owner_name) desiredMembers.push({ household_id: hid, full_name: p.joint_owner_name, relationship: 'joint_owner', phone: p.joint_owner_phone })
    }
    const memberHids = Array.from(new Set(desiredMembers.map((m) => m.household_id)))
    const existingMemberKeys = await existingPairs(db, 'household_members', 'household_id', 'full_name', memberHids)
    const newMemberRows = desiredMembers.filter((m) => !existingMemberKeys.has(`${m.household_id}|${m.full_name.toLowerCase()}`))
    await insertChunked(db, 'household_members', newMemberRows)

    // 4. Policies → household_policies.
    const newPolicyRows = policyNumbers.filter((pn) => !existingPolSet.has(pn)).map((pn) => {
      const p = policyByNumber.get(pn)!
      const hid = householdId.get(p.book_owner_key)
      if (!hid) return null
      return { household_id: hid, policy_number: p.policy_number, product_name: p.product_name, status: p.status, is_with_us: true, is_security: p.is_security, premium: null, face_amount: p.face_amount, accumulation_value: p.accumulation_value, effective_date: p.issue_date, conversion_deadline: p.conversion_date, source_system: 'fnwl', source_data: p.source_data }
    }).filter((r): r is NonNullable<typeof r> => r !== null)
    await insertChunked(db, 'household_policies', newPolicyRows)

    // 5. Contacts — one per person, linked, idempotent on book_key.
    const contactRows: Array<Record<string, unknown>> = []
    const pushContact = (book_key: string, name: string, type: string, extra: Record<string, unknown>) => {
      if (existingContactSet.has(book_key)) return
      const nm = splitName(name)
      contactRows.push({ book_key, full_name: name, first_name: nm.first || null, last_name: nm.last || null, contact_type: type, source: 'fnwl_book', status: 'active', created_by: actor, tags: ['fnwl-book'], ...extra })
    }
    for (const k of ownerKeys) {
      const p = households.get(k)!
      pushContact(`owner:${k}`, p.owner_name, 'client', { email: p.owner_email, email_lc: emailLc(p.owner_email), phone: p.owner_phone, phone_digits: phoneDigits(p.owner_phone), address: p.owner_address, city: p.owner_city, state: p.owner_state, zip: p.owner_zip, household_id: householdId.get(k) ?? null, agency_partnership_id: p.serving_agent_no ? agencyId.get(p.serving_agent_no) ?? null : null })
    }
    for (const [k, p] of Array.from(joints.entries())) {
      pushContact(`joint:${k}`, p.joint_owner_name!, 'client', { phone: p.joint_owner_phone, phone_digits: phoneDigits(p.joint_owner_phone), address: p.joint_owner_address, city: p.joint_owner_city, state: p.joint_owner_state, zip: p.joint_owner_zip, household_id: householdId.get(p.book_owner_key) ?? null, agency_partnership_id: p.serving_agent_no ? agencyId.get(p.serving_agent_no) ?? null : null })
    }
    for (const no of agentNos) {
      pushContact(`agent:${no}`, agents.get(no)!, 'agency_owner', { agency_partnership_id: agencyId.get(no) ?? null })
    }
    await insertChunked(db, 'contacts', contactRows)

    await writeAudit({ actor, action: 'import.committed', entity: 'inforce_book', entityId: null, diff: { filename: file.name, plan, securities: summary.securities } })

    return NextResponse.json({
      mode: 'commit',
      filename: file.name,
      summary: { ...summary, joint_owners: joints.size },
      plan,
      committed: { agencies_new: newAgencyRows.length, households_new: newHouseholdKeys.length, members_added: newMemberRows.length, policies_added: newPolicyRows.length, contacts_added: contactRows.length },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Commit failed' }, { status: 500 })
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function existingKeys(db: any, table: string, keyCol: string, values: string[], fnwlOnly = false): Promise<Set<string>> {
  const set = new Set<string>()
  for (let i = 0; i < values.length; i += CHUNK) {
    let q = db.from(table).select(keyCol).in(keyCol, values.slice(i, i + CHUNK))
    if (fnwlOnly) q = q.eq('source_system', 'fnwl')
    const { data } = await q
    for (const r of data || []) if (r[keyCol] != null) set.add(String(r[keyCol]))
  }
  return set
}

// Set of "col1|lower(col2)" pairs that already exist among the given col1 values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function existingPairs(db: any, table: string, col1: string, col2: string, col1Values: string[]): Promise<Set<string>> {
  const set = new Set<string>()
  for (let i = 0; i < col1Values.length; i += CHUNK) {
    const { data } = await db.from(table).select(`${col1}, ${col2}`).in(col1, col1Values.slice(i, i + CHUNK))
    for (const r of data || []) if (r[col1] != null && r[col2] != null) set.add(`${r[col1]}|${String(r[col2]).toLowerCase()}`)
  }
  return set
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertChunked(db: any, table: string, rows: any[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from(table).insert(rows.slice(i, i + CHUNK))
    if (error) throw new Error(`${table} insert failed: ${error.message}`)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mapIds(db: any, table: string, keyCol: string, idCol: string, keys: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { data } = await db.from(table).select(`${idCol}, ${keyCol}`).in(keyCol, keys.slice(i, i + CHUNK))
    for (const r of data || []) if (r[keyCol] != null) map.set(String(r[keyCol]), String(r[idCol]))
  }
  return map
}
