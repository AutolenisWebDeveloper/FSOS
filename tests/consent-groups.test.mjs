// Consent-group bulk-import grants. Proves the PURE cores offline:
//   • the consent-group registry resolves known groups, rejects unknown keys, and carries a
//     documented disclosure + provenance source for each (TCPA/audit basis, never blank);
//   • selectableChannels intersects the operator's per-import request with the group's
//     permitted channels (a group can never seed a channel it does not cover);
//   • planGroupGrants seeds ONLY the selected channels, and — reusing the shared suppression
//     core — a later opt-out ALWAYS wins: an existing revoke, a channel DNC (tolerant of
//     +1/bare drift), or a do_not_contact household is never re-consented by a bulk grant;
//   • an already-granted member is an idempotent no-op skip.
// No DB, no server, no clock.
// Run: node tests/consent-groups.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-consent-groups-'))
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
    `--rootDir src/lib --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { CONSENT_GROUPS, CONSENT_GROUP_KEYS, isConsentGroupKey, resolveConsentGroup, selectableChannels } = require(
  join(out, 'comms/consent-groups.js'),
)
const { planGroupGrants } = require(join(out, 'comms/consent-group-grant.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const M = (id, over = {}) => ({ id, household_id: `h_${id}`, email: `${id}@ex.com`, phone: `+1214555${id.padStart(4, '0')}`, ...over })

console.log('registry — the four groups resolve with a documented basis')
t('exactly the four expected keys, each with a disclosure + source + tag', () => {
  assert.deepEqual([...CONSENT_GROUP_KEYS].sort(), ['cross_sell_life', 'district_book', 'life_conversion', 'win_back'])
  for (const k of CONSENT_GROUP_KEYS) {
    const g = CONSENT_GROUPS[k]
    assert.equal(g.key, k)
    assert.ok(g.label && g.label.length > 0, `${k} has a label`)
    assert.ok(g.disclosure && g.disclosure.length > 20, `${k} carries a non-trivial documented disclosure`)
    assert.ok(g.source.startsWith('import_group:'), `${k} source is a provenance label`)
    assert.ok(g.tag && g.tag.length > 0, `${k} has a tag`)
    assert.ok(Array.isArray(g.channels) && g.channels.length > 0, `${k} declares channels`)
  }
})

t('isConsentGroupKey / resolveConsentGroup guard unknown input', () => {
  assert.equal(isConsentGroupKey('district_book'), true)
  assert.equal(isConsentGroupKey('nope'), false)
  assert.equal(isConsentGroupKey(''), false)
  assert.equal(isConsentGroupKey(null), false)
  assert.equal(isConsentGroupKey(42), false)
  assert.equal(resolveConsentGroup('nope'), null)
  assert.equal(resolveConsentGroup('win_back').key, 'win_back')
})

console.log('selectableChannels — request intersected with the group')
t('empty request defaults to the full group channel set (sms→email order)', () => {
  assert.deepEqual(selectableChannels(CONSENT_GROUPS.district_book, []), ['sms', 'email'])
  assert.deepEqual(selectableChannels(CONSENT_GROUPS.district_book, null), ['sms', 'email'])
})
t('a specific request narrows the set', () => {
  assert.deepEqual(selectableChannels(CONSENT_GROUPS.district_book, ['email']), ['email'])
  assert.deepEqual(selectableChannels(CONSENT_GROUPS.district_book, ['sms']), ['sms'])
})
t('a request outside the group is dropped, never seeded', () => {
  const narrow = { ...CONSENT_GROUPS.district_book, channels: ['email'] }
  assert.deepEqual(selectableChannels(narrow, ['sms', 'email']), ['email'])
  assert.deepEqual(selectableChannels(narrow, ['sms']), [])
})

console.log('planGroupGrants — seeds only the selected channels')
t('email-only selection creates email grants only', () => {
  const { report } = planGroupGrants([M('1'), M('2')], [], [], [], ['email'])
  assert.equal(report.emailCreated, 2)
  assert.equal(report.smsCreated, 0)
})
t('both channels selected creates both', () => {
  const { report } = planGroupGrants([M('1')], [], [], [], ['sms', 'email'])
  assert.equal(report.smsCreated, 1)
  assert.equal(report.emailCreated, 1)
})

console.log('SUPPRESSION — a bulk group grant can NEVER override a later opt-out')
t('an existing sms revoke is never re-granted', () => {
  const existing = [{ member_id: '1', channel: 'sms', status: 'revoked' }]
  const { report } = planGroupGrants([M('1')], existing, [], [], ['sms', 'email'])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.skippedRevoked, 1)
  assert.equal(report.emailCreated, 1) // the un-revoked channel still seeds
})
t('a channel DNC suppresses that channel (tolerant +1/bare match)', () => {
  const dnc = [{ contact: '2145550001', channel: 'sms' }]
  const { report } = planGroupGrants([M('1', { phone: '+12145550001' })], [], dnc, [], ['sms', 'email'])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.skippedDnc, 1)
  assert.equal(report.emailCreated, 1)
})
t("a channel 'all' DNC suppresses BOTH selected channels", () => {
  const dnc = [
    { contact: '1@ex.com', channel: 'all' },
    { contact: '+12145550001', channel: 'all' },
  ]
  const { report } = planGroupGrants([M('1', { phone: '+12145550001' })], [], dnc, [], ['sms', 'email'])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.emailCreated, 0)
  assert.equal(report.skippedDnc, 2)
})
t('a do_not_contact household skips the whole member', () => {
  const { report } = planGroupGrants([M('1')], [], [], ['h_1'], ['sms', 'email'])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.emailCreated, 0)
  assert.equal(report.skippedHouseholdDnc, 2)
})

console.log('idempotency — an existing grant is a no-op skip')
t('re-running over an already-granted member creates nothing', () => {
  const existing = [
    { member_id: '1', channel: 'sms', status: 'granted' },
    { member_id: '1', channel: 'email', status: 'granted' },
  ]
  const { report } = planGroupGrants([M('1')], existing, [], [], ['sms', 'email'])
  assert.equal(report.smsCreated, 0)
  assert.equal(report.emailCreated, 0)
  assert.equal(report.skippedAlreadyGranted, 2)
})

console.log(`\n✓ consent-groups: ${passed} assertions passed`)
