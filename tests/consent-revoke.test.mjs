// Bulk consent REVOKE planner + tag-catalog aggregator — pure cores, proved offline.
//
//   • planRevoke: revoke ALWAYS applies (it is the §12 gate's first suppression winner) — a
//     granted member+channel is updated to revoked, a member with no row gets a revoked row
//     created, and an already-revoked member+channel is an idempotent no-op skip. The previous
//     status rides on every decision for the audit trail (previous → new value).
//   • aggregateTagCounts: distinct, normalized (trim+lower) tag → contact count, most-used
//     first; a contact never double-counts a tag it carries twice.
// No DB, no server, no clock.
// Run: node tests/consent-revoke.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-consent-revoke-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(
  `npx tsc src/lib/comms/consent-revoke.ts src/lib/comms/contact-tag-catalog.ts ` +
    `src/lib/comms/consent-population.ts src/lib/comms/contact-consent.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const { planRevoke } = require(join(out, 'consent-revoke.js'))
const { aggregateTagCounts, normalizeTag } = require(join(out, 'contact-tag-catalog.js'))

let passed = 0
const ok = (name, fn) => {
  fn()
  passed++
  console.log('  ✓ ' + name)
}

const members = [
  { id: 'm1', household_id: 'h1', email: 'a@x.com', phone: '5125550001' }, // granted email, none sms
  { id: 'm2', household_id: 'h2', email: 'b@x.com', phone: '5125550002' }, // already revoked sms
  { id: 'm3', household_id: 'h3', email: 'c@x.com', phone: '5125550003' }, // no rows
]
const existing = [
  { member_id: 'm1', channel: 'email', status: 'granted' },
  { member_id: 'm2', channel: 'sms', status: 'revoked' },
]

ok('revoke updates granted, creates where missing, skips already-revoked', () => {
  const { report } = planRevoke(members, existing, ['sms', 'email'])
  assert.equal(report.membersProcessed, 3)
  // sms: m1 create, m2 already-revoked skip, m3 create = 2 revoked
  assert.equal(report.smsRevoked, 2)
  // email: m1 update (granted→revoked), m2 create, m3 create = 3 revoked
  assert.equal(report.emailRevoked, 3)
  assert.equal(report.skippedAlreadyRevoked, 1)
})

ok('revoke carries the previous status for the audit trail', () => {
  const { decisions } = planRevoke(members, existing, ['email'])
  const m1 = decisions.find((d) => d.memberId === 'm1' && d.channel === 'email')
  assert.equal(m1.previousStatus, 'granted')
  assert.equal(m1.revoke, true)
  const m3 = decisions.find((d) => d.memberId === 'm3' && d.channel === 'email')
  assert.equal(m3.previousStatus, 'none')
})

ok('single-channel revoke ignores the other channel', () => {
  const { report } = planRevoke(members, existing, ['sms'])
  assert.equal(report.smsRevoked, 2)
  assert.equal(report.emailRevoked, 0)
  assert.equal(report.skippedAlreadyRevoked, 1)
})

// ── tag catalog ──────────────────────────────────────────────────────────────
ok('aggregateTagCounts normalizes, de-dupes per contact, and sorts by count', () => {
  const rows = [
    { tags: ['Win-Back', 'life-winback'] },
    { tags: ['win-back ', 'FNWL-Book'] },
    { tags: ['win-back', 'win-back'] }, // duplicate on one contact → counts once
    { tags: null },
    { tags: ['fnwl-book'] },
  ]
  const cat = aggregateTagCounts(rows)
  const byTag = Object.fromEntries(cat.map((c) => [c.tag, c.contacts]))
  assert.equal(byTag['win-back'], 3)
  assert.equal(byTag['fnwl-book'], 2)
  assert.equal(byTag['life-winback'], 1)
  // sorted: win-back (3) first
  assert.equal(cat[0].tag, 'win-back')
})

ok('normalizeTag trims and lower-cases', () => {
  assert.equal(normalizeTag('  Cross-Sell '), 'cross-sell')
  assert.equal(normalizeTag(null), '')
})

console.log(`\n✓ consent-revoke + tag-catalog: ${passed} checks passed.`)
