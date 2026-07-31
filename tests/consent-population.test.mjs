// §B — existing-client consent population. Proves the PURE planner offline: a granted row
// is seeded for BOTH channels for every current member, while every later opt-out wins —
// an existing revoke, a channel DNC (tolerant of +1/bare drift), or a do_not_contact
// household. Idempotent: an existing grant is a no-op skip. No DB, no server.
// Run: node tests/consent-population.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-consent-pop-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(
  `npx tsc src/lib/comms/consent-population.ts src/lib/comms/contact-consent.ts ` +
    `--rootDir src/lib --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { planPopulation, decideChannel, buildSuppressionIndex, indexExistingConsents, buildConsentGrantRow } = require(
  join(out, 'comms/consent-population.js'),
)

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const M = (id, over = {}) => ({ id, household_id: `h_${id}`, email: `${id}@ex.com`, phone: `+1214555${id.padStart(4, '0')}`, ...over })

console.log('planPopulation (happy path — every member gets both channels)')
t('two fresh members → 2 sms + 2 email grants, nothing skipped', () => {
  const { report } = planPopulation([M('1'), M('2')], [], [], [])
  assert.equal(report.membersProcessed, 2)
  assert.equal(report.smsCreated, 2)
  assert.equal(report.emailCreated, 2)
  assert.equal(report.skippedAlreadyGranted, 0)
  assert.equal(report.skippedRevoked, 0)
  assert.equal(report.skippedDnc, 0)
  assert.equal(report.skippedHouseholdDnc, 0)
})

console.log('idempotency — existing grant is a no-op skip')
t('re-run over already-granted members creates nothing', () => {
  const existing = [
    { member_id: '1', channel: 'sms', status: 'granted' },
    { member_id: '1', channel: 'email', status: 'granted' },
  ]
  const { report } = planPopulation([M('1')], existing, [], [])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.emailCreated, 0)
  assert.equal(report.skippedAlreadyGranted, 2)
})

console.log('revoke wins — never overwrite a later opt-out')
t('an existing sms revoke skips sms but still grants email', () => {
  const existing = [{ member_id: '1', channel: 'sms', status: 'revoked' }]
  const { report } = planPopulation([M('1')], existing, [], [])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.skippedRevoked, 1)
  assert.equal(report.emailCreated, 1)
})

console.log('DNC wins — channel-specific suppression')
t('email on DNC skips email only; sms still granted', () => {
  const dnc = [{ contact: '1@ex.com', channel: 'email' }]
  const { report } = planPopulation([M('1')], [], dnc, [])
  assert.equal(report.emailCreated, 0)
  assert.equal(report.skippedDnc, 1)
  assert.equal(report.smsCreated, 1)
})

t("SMS DNC matches tolerantly on the last-10 digits (bare vs +1)", () => {
  // Member phone stored as +12145550001; DNC stored bare 2145550001 → still suppressed.
  const dnc = [{ contact: '2145550001', channel: 'sms' }]
  const { report } = planPopulation([M('1', { phone: '+12145550001' })], [], dnc, [])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.skippedDnc, 1)
  assert.equal(report.emailCreated, 1)
})

t("channel 'all' DNC suppresses BOTH channels", () => {
  const dnc = [
    { contact: '1@ex.com', channel: 'all' },
    { contact: '+12145550001', channel: 'all' },
  ]
  const { report } = planPopulation([M('1', { phone: '+12145550001' })], [], dnc, [])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.emailCreated, 0)
  assert.equal(report.skippedDnc, 2)
})

console.log('household do_not_contact wins — skip the whole member')
t('a do_not_contact household skips both channels', () => {
  const { report } = planPopulation([M('1')], [], [], ['h_1'])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.emailCreated, 0)
  assert.equal(report.skippedHouseholdDnc, 2)
})

console.log('no contact value — still granted (member-keyed permission)')
t('a member with no phone still gets an sms grant', () => {
  const d = decideChannel(
    { id: '1', household_id: 'h1', email: null, phone: null },
    'sms',
    indexExistingConsents([]),
    buildSuppressionIndex([], []),
  )
  assert.equal(d.grant, true)
})

console.log('buildConsentGrantRow (insert shape)')
t('produces a granted row with the population source + captured_at', () => {
  const row = buildConsentGrantRow('m1', 'h1', 'email', 'existing_client_optin', '2026-07-31T00:00:00.000Z')
  assert.equal(row.member_id, 'm1')
  assert.equal(row.household_id, 'h1')
  assert.equal(row.channel, 'email')
  assert.equal(row.status, 'granted')
  assert.equal(row.source, 'existing_client_optin')
  assert.equal(row.captured_at, '2026-07-31T00:00:00.000Z')
})

console.log(`\n✓ consent-population: ${passed} assertions passed`)
