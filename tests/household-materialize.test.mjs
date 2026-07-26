// tests/household-materialize.test.mjs — Slice 3 (Household materialization).
// Proves the PURE materialization logic that the DB executor runs:
//   • eligibility (client-side types in, agency_owner/business out)
//   • deterministic grouping keys (spouses group, unrelated people don't)
//   • the plan (create / group / skip) for each existing-state
//   • idempotency: replaying the same book creates ZERO new households/members
//
// Run with: node tests/household-materialize.test.mjs  (esbuild-bundled like resolution.test.mjs)

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let mod
try {
  const dir = mkdtempSync(join(tmpdir(), 'hm-'))
  const out = join(dir, 'mod.mjs')
  execSync(
    `npx --yes esbuild@0.21.5 src/lib/services/householdMaterialize.ts --bundle --platform=node --format=esm --packages=external --outfile=${out}`,
    { stdio: 'ignore' },
  )
  mod = await import(out)
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild is unavailable:', e.message)
    process.exit(1)
  }
  console.log('household-materialize.test.mjs — SKIPPED (esbuild unavailable):', e.message)
  process.exit(0)
}

const { isMaterializable, lastNameOf, householdOriginKey, deriveHouseholdName, planMaterialization, MATERIALIZABLE_TYPES } = mod

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.log('  ✗', msg) } }

console.log('materialize — eligibility')
for (const t of ['client', 'prospect', 'cross_sell', 'term_conversion', 'unknown']) ok(isMaterializable({ contact_type: t }), `${t} is materializable`)
ok(!isMaterializable({ contact_type: 'agency_owner' }), 'agency_owner excluded (B2B)')
ok(!isMaterializable({ contact_type: 'business' }), 'business excluded (B2B)')
ok(isMaterializable({ contact_type: null }) === true, 'null type treated as unknown → eligible')
ok(MATERIALIZABLE_TYPES.length === 5, 'five materializable types')

console.log('materialize — last name derivation')
ok(lastNameOf({ last_name: 'Smith', full_name: 'Al Smith' }) === 'Smith', 'explicit last_name used')
ok(lastNameOf({ last_name: '', full_name: 'Al Smith' }) === 'Smith', 'derived from full_name')
ok(lastNameOf({ full_name: 'Cher' }) === '', 'single-token name → no last name')

console.log('materialize — grouping keys')
const alice = { id: 'a', full_name: 'Alice Smith', last_name: 'Smith', address: '100 Main St', zip: '75000' }
const bob = { id: 'b', full_name: 'Bob Smith', last_name: 'Smith', address: '100 Main St.', zip: '75000-1234' }
const carol = { id: 'c', full_name: 'Carol Jones', last_name: 'Jones', address: '100 Main St', zip: '75000' }
const dave = { id: 'd', full_name: 'Dave Lee', last_name: 'Lee', address: null, zip: null }
ok(householdOriginKey(alice) === householdOriginKey(bob), 'spouses (same last+street+zip, punctuation-insensitive) → same key')
ok(householdOriginKey(alice) !== householdOriginKey(carol), 'same address, different last name → different key')
ok(householdOriginKey(dave) === 'hh:solo:d', 'no address → per-contact solo key')
ok(householdOriginKey(dave) !== householdOriginKey({ id: 'e', full_name: 'Ed Lee', last_name: 'Lee' }), 'two address-less contacts never collide')

console.log('materialize — household naming')
ok(deriveHouseholdName(alice, true) === 'Smith Household', 'grouped → "<Last> Household"')
ok(deriveHouseholdName(dave, false) === 'Dave Lee', 'solo → full name')

console.log('materialize — plan by existing-state')
const pIneligible = planMaterialization({ id: 'x', full_name: 'Ag Owner', contact_type: 'agency_owner' }, {})
ok(pIneligible.action === 'ineligible' && !pIneligible.createHousehold && !pIneligible.createMember, 'ineligible → no rows')

const pNew = planMaterialization({ ...alice, contact_type: 'client', owner_scope: 'u1', agency_partnership_id: 'ap1' }, {})
ok(pNew.action === 'created' && pNew.createHousehold && pNew.createMember, 'no existing → create household + member')
ok(pNew.householdFields.origin_key === householdOriginKey(alice), 'household carries the origin_key')
ok(pNew.householdFields.referring_agency_id === 'ap1' && pNew.householdFields.owner_scope === 'u1', 'agency + owner_scope carried to household')
ok(pNew.memberFields.relationship === 'primary' && pNew.memberFields.source_contact_id === 'a', 'first member is primary + linked to contact')

const pGroup = planMaterialization({ ...bob, contact_type: 'client' }, { householdIdForKey: 'H1' })
ok(pGroup.action === 'grouped' && !pGroup.createHousehold && pGroup.createMember, 'existing household for key → add member only')
ok(pGroup.memberFields.relationship === 'member' && pGroup.memberFields.household_id === 'H1' && pGroup.linkHouseholdId === 'H1', 'member joins the existing household')

const pExists = planMaterialization({ ...alice, contact_type: 'client' }, { memberHouseholdId: 'H9' })
ok(pExists.action === 'exists' && !pExists.createHousehold && !pExists.createMember && pExists.linkHouseholdId === 'H9', 'already materialized → link only, no new rows')

console.log('materialize — idempotent grouping over a book (simulated store)')
// In-memory store mirroring the two lookups + applies the executor performs.
function runBackfill(contacts, store) {
  let hCreated = 0, mCreated = 0
  for (const c of contacts) {
    const memberHouseholdId = store.membersByContact.get(c.id) ?? null
    const key = householdOriginKey(c)
    const householdIdForKey = store.householdByKey.get(key) ?? null
    const plan = planMaterialization(c, { memberHouseholdId, householdIdForKey })
    if (plan.action === 'created') {
      const hid = `H${store.nextH++}`
      store.householdByKey.set(key, hid)
      store.membersByContact.set(c.id, hid)
      hCreated++; mCreated++
    } else if (plan.action === 'grouped') {
      store.membersByContact.set(c.id, plan.linkHouseholdId)
      mCreated++
    } // 'exists' / 'ineligible' → no-op
  }
  return { hCreated, mCreated }
}
const book = [
  { ...alice, contact_type: 'client' },
  { ...bob, contact_type: 'client' },     // groups with alice
  { ...carol, contact_type: 'prospect' }, // own household (diff last name)
  { ...dave, contact_type: 'unknown' },   // own solo household
  { id: 'z', full_name: 'Zed Owner', contact_type: 'agency_owner', address: '5 Oak', last_name: 'Owner' }, // excluded
]
const store = { householdByKey: new Map(), membersByContact: new Map(), nextH: 1 }
const first = runBackfill(book, store)
ok(first.hCreated === 3, 'first pass: 3 households (Smith couple, Jones, Lee) — owner excluded')
ok(first.mCreated === 4, 'first pass: 4 members (2 Smiths, Jones, Lee)')
ok(store.householdByKey.size === 3, 'store holds 3 distinct households')

const second = runBackfill(book, store)
ok(second.hCreated === 0 && second.mCreated === 0, 're-run creates ZERO new households/members (idempotent)')

console.log(`\n${pass} passed, ${fail} failed.`)
if (fail > 0) process.exit(1)
