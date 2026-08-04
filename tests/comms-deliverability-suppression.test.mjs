// Email deliverability suppression — the PURE classifier that decides whether a
// Resend bounce/complaint event must suppress the recipient (§4.1 no invented data,
// §12 dispatcher gate step 3). Proves classification offline: no DB, no network.
//
// Architecture note: the ONLY genuine gap in FSOS's suppression subsystem was that
// the Resend webhook recorded a bounce/complaint as message STATUS but never
// suppressed the recipient. SMS STOP, the gate's DNC step, the dnc_entries store,
// and the suppressContact() path already existed. This proves the classifier that
// feeds bounce/complaint events into that existing path — it does NOT introduce a
// parallel suppression table.
//
// Run: node tests/comms-deliverability-suppression.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-deliv-supp-'))
// deliverability-core.ts is PURE (no imports) so it compiles standalone.
execSync(
  `npx tsc src/lib/comms/deliverability-core.ts ` +
    `--rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const core = require(join(out, 'lib/comms/deliverability-core.js'))
const { classifyDeliverabilityEvent, isHardBounce, suppressionProvenanceFor } = core

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('deliverability-core — classify (§12 step 3 feed)')

t('spam complaint always suppresses as spam_complaint', () => {
  assert.deepEqual(classifyDeliverabilityEvent('complained', null), { reason: 'spam_complaint' })
  // A complaint suppresses regardless of any bounce payload.
  assert.deepEqual(classifyDeliverabilityEvent('complained', { type: 'Transient' }), { reason: 'spam_complaint' })
})

t('hard/permanent bounce suppresses as hard_bounce', () => {
  assert.deepEqual(classifyDeliverabilityEvent('bounced', { type: 'Permanent' }), { reason: 'hard_bounce' })
  assert.deepEqual(classifyDeliverabilityEvent('bounced', { type: 'Undetermined' }), { reason: 'hard_bounce' })
})

t('an unclassified bounce defaults to hard (conservative for deliverability)', () => {
  assert.deepEqual(classifyDeliverabilityEvent('bounced', null), { reason: 'hard_bounce' })
  assert.deepEqual(classifyDeliverabilityEvent('bounced', {}), { reason: 'hard_bounce' })
})

t('soft/transient/delayed bounces do NOT suppress (returns null)', () => {
  assert.equal(classifyDeliverabilityEvent('bounced', { type: 'Transient' }), null)
  assert.equal(classifyDeliverabilityEvent('bounced', { subType: 'Soft' }), null)
  assert.equal(classifyDeliverabilityEvent('bounced', { message: 'temporary delivery failure, delayed' }), null)
})

t('isHardBounce reflects the same conservative rule', () => {
  assert.equal(isHardBounce(null), true)
  assert.equal(isHardBounce({ type: 'Permanent' }), true)
  assert.equal(isHardBounce({ type: 'transient' }), false)
  assert.equal(isHardBounce({ classification: 'Soft bounce' }), false)
})

console.log('deliverability-core — provenance mapping (accurate audit + dnc reason)')

t('provenance carries a distinct, truthful reason for each cause', () => {
  const hb = suppressionProvenanceFor('hard_bounce')
  assert.equal(hb.dncReason, 'hard_bounce')
  assert.match(hb.source, /bounce/)
  assert.match(hb.reason, /bounce/i)

  const sc = suppressionProvenanceFor('spam_complaint')
  assert.equal(sc.dncReason, 'spam_complaint')
  assert.match(sc.source, /complaint/)
  assert.match(sc.reason, /complaint/i)
})

console.log(`\n✅ comms-deliverability-suppression: ${passed} passed`)
