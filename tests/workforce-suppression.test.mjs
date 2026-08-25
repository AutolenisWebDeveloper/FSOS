// FSOS-070 — the AI workforce must EXCLUDE a business-suppressed recipient from its outreach
// queue. A reply-terminated contact (FSOS-020) gets an individual BUSINESS suppression row; the
// send gate already blocks such a send, but the queue selector must also drop them so a
// reply-terminated contact is never even queued for the workforce (defense in depth + clean
// queue, matching how securities are excluded at build). This proves the PURE selector logic.
// Run: node tests/workforce-suppression.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-workforce-supp-'))
execSync(
  `npx tsc src/lib/ai/outreach.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { selectForQuota, isSelectable } = require(join(out, 'outreach.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// A fully-contactable, consented, non-DNC candidate — differing ONLY in `suppressed`.
const base = (id, over = {}) => ({
  source: 'win_back', agentKey: 'life_winback', entityType: 'contact', entityId: id,
  householdId: `hh-${id}`, memberId: `m-${id}`, channel: 'email',
  contactable: true, hasConsent: true, onDNC: false, isSecurity: false, suppressed: false,
  signal: { lapsedMonths: 1 }, reason: 'reconnect', recipientName: 'Pat',
  ...over,
})

console.log('a business-suppressed candidate is NOT selectable and is skipped')
t('isSelectable(suppressed) === false', () => {
  assert.equal(isSelectable(base('a', { suppressed: true })), false)
})
t('isSelectable(clean) === true', () => {
  assert.equal(isSelectable(base('b')), true)
})
t('selectForQuota drops the suppressed one with reason business_suppressed, keeps the clean one', () => {
  const { selected, skipped } = selectForQuota(
    [base('clean'), base('supp', { suppressed: true })],
    10,
  )
  const selIds = selected.map((c) => c.entityId)
  assert.ok(selIds.includes('clean'), 'clean candidate must be selected')
  assert.ok(!selIds.includes('supp'), 'suppressed candidate must NOT be selected')
  const suppSkip = skipped.find((s) => s.candidate.entityId === 'supp')
  assert.ok(suppSkip, 'suppressed candidate must appear in skipped (never silently dropped)')
  assert.equal(suppSkip.reason, 'business_suppressed')
})
t('a suppressed candidate does not consume quota (quota fills from clean candidates)', () => {
  const { selected } = selectForQuota(
    [base('supp1', { suppressed: true }), base('c1'), base('c2')],
    2,
  )
  const ids = selected.map((c) => c.entityId).sort()
  assert.deepEqual(ids, ['c1', 'c2'], 'both clean candidates fill the quota; suppressed excluded')
})

console.log(`\nAll ${passed} assertions passed.`)
