// Contacts saved-view membership (pure, redesign spec §4.1/§17.5). Verifies each
// saved view's rule so the per-workflow lists (Conversion/Cross-Sell/Win-Back)
// reproduce as filters over one population.
// Run: node tests/contact-views.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-views-'))
execSync(
  `npx tsc src/lib/contacts/views.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { contactViewKeys, CONTACT_VIEW_KEYS, isContactView } = require(join(out, 'views.js'))

const base = {
  archived: false,
  doNotContact: false,
  policyCount: 0,
  activePolicy: false,
  heldAwayPolicy: false,
  lapsedPolicy: false,
  conversionEligible: false,
  hasReview: false,
  lastReviewAgeDays: null,
  recentlyContacted: false,
}

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('all + my-book always for a non-archived contact', () => {
  const k = contactViewKeys(base)
  assert.ok(k.includes('all'))
  assert.ok(k.includes('my-book'))
})

t('archived contact is out of my-book / prospects / needs-contact', () => {
  const k = contactViewKeys({ ...base, archived: true })
  assert.ok(k.includes('all'))
  assert.ok(!k.includes('my-book'))
  assert.ok(!k.includes('prospects'))
  assert.ok(!k.includes('needs-contact'))
})

t('no policies → prospects; active policy → active (not prospects)', () => {
  assert.ok(contactViewKeys(base).includes('prospects'))
  const active = contactViewKeys({ ...base, policyCount: 2, activePolicy: true })
  assert.ok(active.includes('active'))
  assert.ok(!active.includes('prospects'))
})

t('conversion / cross-sell / win-back signals', () => {
  assert.ok(contactViewKeys({ ...base, conversionEligible: true }).includes('conversion'))
  assert.ok(contactViewKeys({ ...base, heldAwayPolicy: true }).includes('cross-sell'))
  assert.ok(contactViewKeys({ ...base, lapsedPolicy: true }).includes('win-back'))
})

t('needs-contact: no recent activity, not DNC, not archived', () => {
  assert.ok(contactViewKeys(base).includes('needs-contact'))
  assert.ok(!contactViewKeys({ ...base, recentlyContacted: true }).includes('needs-contact'))
  assert.ok(!contactViewKeys({ ...base, doNotContact: true }).includes('needs-contact'))
})

t('review-due: no review, or stale review > 365d; fresh review is not due', () => {
  assert.ok(contactViewKeys(base).includes('review-due')) // no review
  assert.ok(contactViewKeys({ ...base, hasReview: true, lastReviewAgeDays: 400 }).includes('review-due'))
  assert.ok(!contactViewKeys({ ...base, hasReview: true, lastReviewAgeDays: 100 }).includes('review-due'))
})

t('every returned key is a known view', () => {
  const k = contactViewKeys({ ...base, activePolicy: true, heldAwayPolicy: true, lapsedPolicy: true, conversionEligible: true })
  for (const key of k) assert.ok(CONTACT_VIEW_KEYS.includes(key), `${key} known`)
  assert.equal(isContactView('all'), true)
  assert.equal(isContactView('nope'), false)
})

console.log(`\nAll ${passed} assertions passed.`)
