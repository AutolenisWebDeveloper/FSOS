// Business communication suppression — the PURE classifier + effective-suppression
// resolver. Proves offline (no DB): transactional purposes are never business-suppressed,
// unknown classification fails closed (suppressible), the individual layer wins over the
// agent/book layer, and a lookup failure fails CLOSED. The DB reads live behind an
// injectable reader seam, so this exercises the decision logic with a fake reader.
//
// Run: node tests/comms-suppression.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-suppression-'))
// suppression.ts imports only a TYPE from purpose.ts (erased) and dynamically imports the
// supabase client ONLY inside the default reader — never reached here. Compile both pure files.
execSync(
  `npx tsc src/lib/comms/suppression.ts src/lib/comms/purpose.ts ` +
    `--rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { businessSuppressionApplies, isBusinessSuppressible, resolveEffectiveSuppression } = require(join(out, 'lib/comms/suppression.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }
const run = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

// Fake reader factory — returns a reader whose load() yields the given signals, or throws.
const reader = ({ clientBlocked = false, agencyBlocked = false, err = null } = {}) => ({
  async load() {
    if (err) throw new Error(err)
    return { clientBlocked, agencyBlocked }
  },
})

console.log('businessSuppressionApplies — taxonomy (non-transactional only)')

t('marketing-class purposes ARE suppressible', () => {
  for (const p of ['MARKETING', 'WORKSHOP', 'BIRTHDAY', 'RELATIONSHIP']) {
    assert.equal(businessSuppressionApplies(p), true, p)
  }
})

t('transactional/servicing purposes are NOT suppressible', () => {
  for (const p of ['TRANSACTIONAL', 'SERVICING', 'APPOINTMENT', 'APPLICATION_STATUS', 'DOCUMENT_REQUEST', 'POLICY_DEADLINE']) {
    assert.equal(businessSuppressionApplies(p), false, p)
  }
})

t('unknown / absent classification FAILS CLOSED (suppressible)', () => {
  assert.equal(businessSuppressionApplies(undefined), true)
  assert.equal(businessSuppressionApplies(null), true)
  assert.equal(businessSuppressionApplies(''), true)
  assert.equal(businessSuppressionApplies('SOMETHING_NEW'), true)
})

console.log('isBusinessSuppressible — send-level applicability (transactional + deliberate exemptions)')

t('automated marketing send IS suppressible', () => {
  assert.equal(isBusinessSuppressible({ purpose: 'MARKETING' }), true)
  assert.equal(isBusinessSuppressible({ purpose: undefined }), true) // fail closed
})

t('transactional purpose is NOT suppressible', () => {
  assert.equal(isBusinessSuppressible({ purpose: 'APPOINTMENT' }), false)
  assert.equal(isBusinessSuppressible({ purpose: 'SERVICING' }), false)
})

t('human-authored 1:1, test send, and explicit opt-out are NEVER suppressible', () => {
  assert.equal(isBusinessSuppressible({ purpose: 'MARKETING', humanAuthored: true }), false)
  assert.equal(isBusinessSuppressible({ purpose: 'MARKETING', isTest: true }), false)
  assert.equal(isBusinessSuppressible({ purpose: undefined, suppressible: false }), false)
})

console.log('resolveEffectiveSuppression — layered decision')

await run('no blocks → allowed (layer none)', async () => {
  const d = await resolveEffectiveSuppression({ contactId: 'c1' }, reader({}))
  assert.equal(d.suppressed, false)
  assert.equal(d.resolved, true)
  assert.equal(d.layer, 'none')
})

await run('agent/book blocked → suppressed (layer agent_book)', async () => {
  const d = await resolveEffectiveSuppression({ agencyId: 'a1' }, reader({ agencyBlocked: true }))
  assert.equal(d.suppressed, true)
  assert.equal(d.resolved, true)
  assert.equal(d.layer, 'agent_book')
})

await run('individual blocked → suppressed (layer individual)', async () => {
  const d = await resolveEffectiveSuppression({ contactId: 'c1' }, reader({ clientBlocked: true }))
  assert.equal(d.suppressed, true)
  assert.equal(d.layer, 'individual')
})

await run('individual layer WINS over agent/book (ordering)', async () => {
  const d = await resolveEffectiveSuppression({ contactId: 'c1', agencyId: 'a1' }, reader({ clientBlocked: true, agencyBlocked: true }))
  assert.equal(d.suppressed, true)
  assert.equal(d.layer, 'individual') // individual reported first per spec ordering
})

await run('lookup failure FAILS CLOSED (suppressed, unresolved)', async () => {
  const d = await resolveEffectiveSuppression({ contactId: 'c1' }, reader({ err: 'db down' }))
  assert.equal(d.suppressed, true)
  assert.equal(d.resolved, false)
  assert.equal(d.layer, 'none')
})

console.log(`\n✓ suppression: ${passed} assertions passed`)
