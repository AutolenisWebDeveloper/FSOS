// The household book → Contact Record bridge (src/lib/contacts/member-link.ts) — pure,
// DB-free. The book is the Contacts workspace, so this mapping is what decides whether
// an FSA looking at a household member can reach that person's full Contact Record.
//
// The three things the pages depend on: only members carrying source_contact_id are
// probed (mig 071's FK, backfilled by 091 — never a name/email guess), only contacts
// confirmed LIVE produce a link (a soft-deleted contact 404s at /app/contacts/[id], so
// offering it would be worse than offering nothing), and the probe list is bounded.
// Run: node tests/contact-member-link.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-memberlink-'))
execSync(
  `npx tsc src/lib/contacts/member-link.ts --outDir ${out} --rootDir src/lib/contacts ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const L = require(join(out, 'member-link.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const C3 = '33333333-3333-4333-8333-333333333333'

// ─── contactRecordHref ────────────────────────────────────────────────────────

t('contactRecordHref points at the Contact Record route', () => {
  assert.equal(L.contactRecordHref(C1), `/app/contacts/${C1}`)
})

// ─── linkedContactIds ─────────────────────────────────────────────────────────

t('collects the contact ids a member set points at', () => {
  assert.deepEqual(
    L.linkedContactIds([{ id: 'm1', source_contact_id: C1 }, { id: 'm2', source_contact_id: C2 }]),
    [C1, C2],
  )
})

t('skips members with no contact behind them', () => {
  // A member added directly in the book (/members/new) never had a contact; a PURGED
  // contact clears the column (FK is ON DELETE SET NULL). Both look like this.
  const members = [
    { id: 'm1', source_contact_id: null },
    { id: 'm2' }, // field absent entirely
    { id: 'm3', source_contact_id: '' },
    { id: 'm4', source_contact_id: C1 },
  ]
  assert.deepEqual(L.linkedContactIds(members), [C1])
})

t('de-duplicates, keeping first-seen order', () => {
  const members = [
    { id: 'm1', source_contact_id: C2 },
    { id: 'm2', source_contact_id: C1 },
    { id: 'm3', source_contact_id: C2 },
  ]
  assert.deepEqual(L.linkedContactIds(members), [C2, C1])
})

t('an empty member list probes nothing', () => {
  assert.deepEqual(L.linkedContactIds([]), [])
})

t('the probe list is bounded so one render cannot issue an unbounded IN (...)', () => {
  const many = Array.from({ length: L.MAX_LINK_LOOKUP + 50 }, (_, i) => ({
    id: `m${i}`,
    source_contact_id: `c${i}`,
  }))
  assert.equal(L.linkedContactIds(many).length, L.MAX_LINK_LOOKUP)
})

t('the cap counts DISTINCT ids, not rows', () => {
  const dupes = Array.from({ length: L.MAX_LINK_LOOKUP + 50 }, (_, i) => ({
    id: `m${i}`,
    source_contact_id: i % 2 === 0 ? C1 : C2,
  }))
  assert.deepEqual(L.linkedContactIds(dupes), [C1, C2])
})

// ─── memberContactLinks ───────────────────────────────────────────────────────

t('links a member to its live contact', () => {
  const links = L.memberContactLinks([{ id: 'm1', source_contact_id: C1 }], [C1])
  assert.equal(links.get('m1'), C1)
  assert.equal(links.size, 1)
})

t('a soft-deleted contact yields NO link, not a broken one', () => {
  // /app/contacts/[id] filters deleted_at (record-data), so the id still on the member
  // would render a 404. Absent from `live` = absent from the map.
  const links = L.memberContactLinks([{ id: 'm1', source_contact_id: C1 }], [])
  assert.equal(links.has('m1'), false)
})

t('a member with no contact yields no link', () => {
  const links = L.memberContactLinks([{ id: 'm1', source_contact_id: null }, { id: 'm2' }], [C1])
  assert.equal(links.size, 0)
})

t('mixed households link only the members that resolve', () => {
  const members = [
    { id: 'm1', source_contact_id: C1 }, // live
    { id: 'm2', source_contact_id: C2 }, // soft-deleted
    { id: 'm3', source_contact_id: null }, // book-only member
  ]
  const links = L.memberContactLinks(members, [C1, C3])
  assert.deepEqual([...links], [['m1', C1]])
})

t('accepts a Set as well as an array of live ids', () => {
  const members = [{ id: 'm1', source_contact_id: C1 }]
  assert.equal(L.memberContactLinks(members, new Set([C1])).get('m1'), C1)
})

t('an id that is live but belongs to no member does not invent a row', () => {
  const links = L.memberContactLinks([{ id: 'm1', source_contact_id: null }], [C1, C2])
  assert.equal(links.size, 0)
})

t('two members pointing at one contact both resolve', () => {
  // The unique index on source_contact_id (mig 071) means this should not occur, but a
  // page render must not throw or drop a row if the data ever says otherwise.
  const links = L.memberContactLinks(
    [{ id: 'm1', source_contact_id: C1 }, { id: 'm2', source_contact_id: C1 }],
    [C1],
  )
  assert.equal(links.get('m1'), C1)
  assert.equal(links.get('m2'), C1)
})

t('an empty household maps to no links', () => {
  assert.equal(L.memberContactLinks([], [C1]).size, 0)
})

t('what linkedContactIds probes is exactly what memberContactLinks can resolve', () => {
  // The two halves are used together: ids → query → live set → map. Anything the map
  // could link must have been probed, or the page would silently drop a real link.
  const members = [
    { id: 'm1', source_contact_id: C1 },
    { id: 'm2', source_contact_id: C2 },
    { id: 'm3', source_contact_id: null },
  ]
  const probed = new Set(L.linkedContactIds(members))
  for (const [, contactId] of L.memberContactLinks(members, [C1, C2])) {
    assert.ok(probed.has(contactId), `linked a contact that was never probed: ${contactId}`)
  }
})

console.log(`\n${passed} assertion groups passed`)
