// tests/agency-contact-reconcile.test.mjs
// Proves the agency-owner → Contact Center reconciliation: an imported agent is
// matched to the right existing contact and non-destructively merged (missing
// address/phone filled, valid values kept, ambiguous matches routed to review),
// or created when there's no match — all through the shared resolution engine.
// The DB-writing applier is exercised by build/integration; this proves the pure
// decision + merge shapes the applier feeds.
// Run: node tests/agency-contact-reconcile.test.mjs

import { execSync } from 'node:child_process'
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let reso, owner
try {
  const dir = mkdtempSync(join(tmpdir(), 'agc-'))
  const bundle = (src, name) => {
    const out = join(dir, name)
    execSync(`npx --yes esbuild@0.21.5 ${src} --bundle --platform=node --format=esm --outfile=${out}`, { stdio: 'ignore' })
    return out
  }
  reso = await import(bundle('src/lib/import/resolution.ts', 'resolution.mjs'))
  owner = await import(bundle('src/lib/services/agencyOwnerContact.ts', 'owner.mjs'))
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild is unavailable:', e.message)
    process.exit(1)
  }
  console.log('agency-contact-reconcile.test.mjs — SKIPPED (esbuild unavailable):', e.message)
  process.exit(0)
}

const { buildContactIndex, resolveContact, mergeFields } = reso
const { agencyOwnerIdentifiers, agencyOwnerIncoming, agencyOwnerContactInsert, AGENCY_OWNER_MERGE_SPEC } = owner

let pass = 0, fail = 0
const ok = (c, m) => (c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)))

const agent = {
  agencyId: 'ag-1',
  agentCode: '19413J',
  ownerName: 'Adriana Vasquez',
  email: 'avasquez@farmersagent.com',
  businessPhone: '+13619938412',
  mobilePhone: '+13616582023',
  address: '2743 Airline Rd. #107',
  city: 'Corpus Christi',
  state: 'TX',
  zip: '78414',
}

// 1 — identifiers: provenance key, email, business phone preferred, zip
{
  const ids = agencyOwnerIdentifiers(agent)
  ok(ids.provenanceKeys?.[0] === 'agent:19413J', 'provenance key = agent:<code>')
  ok(ids.email === 'avasquez@farmersagent.com', 'email carried')
  ok(ids.phone === '+13619938412', 'business phone preferred over mobile')
  ok(ids.zip === '78414' && ids.fullName === 'Adriana Vasquez', 'zip + name carried')
}

// 2 — insert shape for a brand-new agency-owner contact
{
  const row = agencyOwnerContactInsert(agent, 'user-1')
  ok(row.book_key === 'agent:19413J', 'insert carries book_key (convergence key)')
  ok(row.contact_type === 'agency_owner', 'insert typed agency_owner')
  ok(row.email_lc === 'avasquez@farmersagent.com', 'email_lc derived')
  ok(row.phone_digits === '13619938412', 'phone_digits derived')
  ok(row.agency_partnership_id === 'ag-1' && row.source === 'agency_directory', 'linked + sourced')
}

// 3 — merge into an existing contact by EMAIL, backfilling only missing fields
{
  const existing = [{ id: 'c1', full_name: 'Adriana Vasquez', email_lc: 'avasquez@farmersagent.com', phone_digits: null, zip: null, street: null }]
  const idx = buildContactIndex(existing)
  const res = resolveContact(idx, agencyOwnerIdentifiers(agent))
  ok(res.action === 'merge' && res.targetId === 'c1' && res.confidence === 'exact', 'email match → exact merge')
  // existing row is missing phone/address; name already present and must be kept
  const existingFull = { first_name: 'Adriana', last_name: 'Vasquez', email: 'avasquez@farmersagent.com', email_lc: 'avasquez@farmersagent.com', phone: null, phone_digits: null, address: null, city: null, state: null, zip: null, agency_partnership_id: null, book_key: null, tags: ['client'] }
  const { patch, merged, rejected } = mergeFields(existingFull, agencyOwnerIncoming(agent), AGENCY_OWNER_MERGE_SPEC)
  ok(patch.phone === '+13619938412' && patch.address === '2743 Airline Rd. #107', 'fills missing phone + address')
  ok(patch.agency_partnership_id === 'ag-1' && patch.book_key === 'agent:19413J', 'links agency + book_key when blank')
  ok(Array.isArray(patch.tags) && patch.tags.includes('client') && patch.tags.includes('agency-directory'), 'tags unioned, not replaced')
  ok(!('email' in patch), 'existing email preserved (not rewritten)')
  ok(merged.includes('phone') && rejected.length === 0, 'merged reported, nothing rejected')
}

// 4 — a differing existing value is REJECTED, never overwritten
{
  const existingFull = { phone: '+19725550000', address: '999 Old St' }
  const { patch, rejected } = mergeFields(existingFull, agencyOwnerIncoming(agent), AGENCY_OWNER_MERGE_SPEC)
  ok(!('phone' in patch) && !('address' in patch), 'differing phone/address not overwritten')
  ok(rejected.some((r) => r.field === 'phone') && rejected.some((r) => r.field === 'address'), 'conflicts recorded for audit')
}

// 5 — no match anywhere → create
{
  const idx = buildContactIndex([{ id: 'x', full_name: 'Someone Else', email_lc: 'other@x.com' }])
  const res = resolveContact(idx, agencyOwnerIdentifiers(agent))
  ok(res.action === 'create' && res.targetId === null, 'no match → create')
}

// 6 — provenance-only match (book_key) merges even with no email/phone on file
{
  const idx = buildContactIndex([{ id: 'c9', full_name: 'A V', provenanceKeys: ['agent:19413J'] }])
  const res = resolveContact(idx, agencyOwnerIdentifiers({ ...agent, email: null, businessPhone: null, mobilePhone: null }))
  ok(res.action === 'merge' && res.targetId === 'c9', 'book_key provenance → merge (idempotent re-import)')
}

// 7 — conflicting strong identifiers (email→c1, phone→c2) → review, never a blind merge
{
  const idx = buildContactIndex([
    { id: 'c1', full_name: 'Adriana Vasquez', email_lc: 'avasquez@farmersagent.com' },
    { id: 'c2', full_name: 'Someone', phone_digits: '13619938412' },
  ])
  const res = resolveContact(idx, agencyOwnerIdentifiers(agent))
  ok(res.action === 'review' && res.conflict === true, 'email vs phone disagree → review (no auto-merge)')
}

console.log(`\nagency-contact-reconcile: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
