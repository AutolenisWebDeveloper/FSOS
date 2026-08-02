// Retroactive consent-group BACKFILL — pure cores, proved offline (no DB, no server, no clock).
//
// The backfill grants consent to contacts ALREADY imported into a group (where consent was
// never seeded at import time). It resolves the population by the group's import tags, then
// reuses the SAME suppression-aware planner as the import-time grant, so:
//   • every group declares a non-empty, de-duplicated import-tag set that ALWAYS includes its
//     own tag plus the legacy per-group importer's marker (the reviewable §4.3 mapping);
//   • planGroupGrants (shared core) still lets a later opt-out WIN — an existing revoke, a
//     channel DNC (tolerant of +1/bare drift), or a do_not_contact household is never
//     re-consented by the backfill, and an already-granted member is an idempotent no-op skip.
// Run: node tests/consent-group-backfill.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-consent-backfill-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(
  `npx tsc src/lib/comms/consent-groups.ts src/lib/comms/consent-group-grant.ts ` +
    `src/lib/comms/consent-population.ts src/lib/comms/contact-consent.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const groups = require(join(out, 'consent-groups.js'))
const { CONSENT_GROUPS, CONSENT_GROUP_KEYS, groupImportTags } = groups
const { planGroupGrants } = require(join(out, 'consent-group-grant.js'))

let passed = 0
const ok = (name, fn) => {
  fn()
  passed++
  console.log('  ✓ ' + name)
}

// ── The import-tag mapping (the reviewable §4.3 config default) ──────────────────
ok('every group declares a non-empty import-tag set that includes its own tag', () => {
  for (const key of CONSENT_GROUP_KEYS) {
    const g = CONSENT_GROUPS[key]
    const tags = groupImportTags(g)
    assert.ok(Array.isArray(tags) && tags.length >= 1, `${key} import tags empty`)
    assert.ok(tags.includes(g.tag), `${key} import tags must include own tag ${g.tag}`)
  }
})

ok('import tags are de-duplicated and lower-cased', () => {
  for (const key of CONSENT_GROUP_KEYS) {
    const tags = groupImportTags(CONSENT_GROUPS[key])
    assert.equal(tags.length, new Set(tags).size, `${key} has duplicate import tags`)
    for (const t of tags) assert.equal(t, t.toLowerCase(), `${key} tag ${t} not lower-cased`)
  }
})

ok('legacy importer markers map to the right group', () => {
  assert.ok(groupImportTags(CONSENT_GROUPS.district_book).includes('fnwl-book'))
  assert.ok(groupImportTags(CONSENT_GROUPS.cross_sell_life).includes('cross-sell'))
  assert.ok(groupImportTags(CONSENT_GROUPS.win_back).includes('win-back'))
  assert.ok(groupImportTags(CONSENT_GROUPS.life_conversion).includes('term-conversion'))
})

// ── The backfill reuses the shared suppression-aware planner ─────────────────────
const members = [
  { id: 'm1', household_id: 'h1', email: 'a@x.com', phone: '5125550001' }, // clean → grant both
  { id: 'm2', household_id: 'h2', email: 'b@x.com', phone: '5125550002' }, // revoked sms → sms skip
  { id: 'm3', household_id: 'h3', email: 'c@x.com', phone: '5125550003' }, // dnc email → email skip
  { id: 'm4', household_id: 'h4', email: 'd@x.com', phone: '5125550004' }, // household dnc → both skip
  { id: 'm5', household_id: 'h5', email: 'e@x.com', phone: '5125550005' }, // already granted email
]
const existing = [
  { member_id: 'm2', channel: 'sms', status: 'revoked' },
  { member_id: 'm5', channel: 'email', status: 'granted' },
]
const dnc = [{ contact: 'c@x.com', channel: 'email' }]
const dncHouseholds = ['h4']

ok('backfill grants only un-suppressed members on the selected channels', () => {
  const { report } = planGroupGrants(members, existing, dnc, dncHouseholds, ['sms', 'email'])
  assert.equal(report.membersProcessed, 5)
  // sms: m1,m3,m5 grant (m2 revoked, m4 household dnc) = 3
  assert.equal(report.smsCreated, 3)
  // email: m1,m2 grant (m3 dnc, m4 household dnc, m5 already granted) = 2
  assert.equal(report.emailCreated, 2)
  assert.equal(report.skippedRevoked, 1)
  assert.equal(report.skippedDnc, 1)
  assert.equal(report.skippedHouseholdDnc, 2)
  assert.equal(report.skippedAlreadyGranted, 1)
})

ok('a later opt-out always wins over a backfill (single-channel select)', () => {
  const { report } = planGroupGrants(members, existing, dnc, dncHouseholds, ['sms'])
  // sms only: m1,m3,m5 grant; m2 revoked skip; m4 household dnc skip
  assert.equal(report.smsCreated, 3)
  assert.equal(report.emailCreated, 0)
  assert.equal(report.skippedRevoked, 1)
  assert.equal(report.skippedHouseholdDnc, 1)
})

console.log(`\n✓ consent-group-backfill: ${passed} checks passed.`)
