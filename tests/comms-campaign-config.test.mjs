// Slice 7 (§15/§16) — Campaign + sequence builder config. Proves the PURE core offline:
// mapping a stored campaign row → the gate-relevant send config (purpose + delegated-sender),
// and the delegated-config validator. Mirrors tests/comms-policy.test.mjs. No DB, no clock.
// Run: node tests/comms-campaign-config.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-campcfg-'))
execSync(
  `npx tsc src/lib/comms/campaign-config.ts src/lib/comms/purpose.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { campaignSendConfig, validateDelegatedConfig, delegationSendContext } = require(join(out, 'campaign-config.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('campaignSendConfig — purpose mapping')

t('a valid stored purpose is surfaced; delegated=false with no delegation config', () => {
  const c = campaignSendConfig({ purpose: 'MARKETING' })
  assert.equal(c.purpose, 'MARKETING')
  assert.equal(c.delegated, false)
})

t('an unknown/invalid purpose is dropped (undefined), not passed to the gate', () => {
  assert.equal(campaignSendConfig({ purpose: 'BOGUS' }).purpose, undefined)
  assert.equal(campaignSendConfig({ purpose: '' }).purpose, undefined)
  assert.equal(campaignSendConfig({}).purpose, undefined)
  assert.equal(campaignSendConfig({ purpose: null }).purpose, undefined)
})

t('all 10 message purposes round-trip through the config mapper', () => {
  for (const p of ['MARKETING','TRANSACTIONAL','SERVICING','APPOINTMENT','RELATIONSHIP','BIRTHDAY','WORKSHOP','APPLICATION_STATUS','DOCUMENT_REQUEST','POLICY_DEADLINE']) {
    assert.equal(campaignSendConfig({ purpose: p }).purpose, p)
  }
})

console.log('campaignSendConfig — delegated-sender detection')

t('delegated=true only when BOTH delegation_id and represented_agency_owner_id are present', () => {
  const c = campaignSendConfig({ delegation_id: 'd1', represented_agency_owner_id: 'o1' })
  assert.equal(c.delegated, true)
  assert.equal(c.delegationId, 'd1')
  assert.equal(c.representedAgencyOwnerId, 'o1')
})

t('a half-configured delegation (owner OR delegation missing) is NOT treated as delegated', () => {
  assert.equal(campaignSendConfig({ delegation_id: 'd1' }).delegated, false)
  assert.equal(campaignSendConfig({ represented_agency_owner_id: 'o1' }).delegated, false)
})

console.log('validateDelegatedConfig — create-time refine')

t('no delegation fields → ok (a plain FSA broadcast)', () => {
  assert.deepEqual(validateDelegatedConfig({}), { ok: true })
})

t('both fields → ok', () => {
  assert.deepEqual(validateDelegatedConfig({ delegationId: 'd', representedAgencyOwnerId: 'o' }), { ok: true })
})

t('delegation without a represented owner is rejected', () => {
  const r = validateDelegatedConfig({ delegationId: 'd' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'represented_agency_owner_required')
})

t('a represented owner without a delegation is rejected (no authority record)', () => {
  const r = validateDelegatedConfig({ representedAgencyOwnerId: 'o' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'delegation_required')
})

console.log('delegationSendContext — assembling the send ctx from a resolved delegation row')

t('builds distinct actual-sender vs represented-party ctx (never one ambiguous field)', () => {
  const ctx = delegationSendContext(
    { agencyId: 'a1', representativeUserId: 'u1', representedAgencyOwnerId: 'o1', delegationId: 'd1' },
    { campaignType: 'broadcast' },
  )
  assert.deepEqual(ctx.delegation, { agencyId: 'a1', campaignType: 'broadcast', senderUserId: 'u1' })
  assert.equal(ctx.ownership.representedAgencyId, 'a1')
  assert.equal(ctx.ownership.representedAgencyOwnerId, 'o1')
  assert.equal(ctx.ownership.delegationId, 'd1')
})

console.log(`\n${passed} assertions passed.`)
