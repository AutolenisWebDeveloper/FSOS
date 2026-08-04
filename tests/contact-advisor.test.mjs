// Contact 360 AI Advisor engine (pure, GREEN ZONE). Verifies the deterministic
// insight builder surfaces facts/deadlines/gaps and recommends WORKFLOW actions
// only — never a product/suitability recommendation, and never a securities
// signal (firewall §4.1 / §4.2). Run: node tests/contact-advisor.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-advisor-'))
execSync(
  `npx tsc src/lib/contacts/advisor.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { buildAdvisor, topInsight } = require(join(out, 'advisor.js'))

const NOW = new Date('2026-08-04T00:00:00Z').getTime()
const base = {
  householdId: 'hh-1',
  doNotContact: false,
  members: [],
  policies: [],
  reviews: [],
  openOpportunities: 0,
  now: NOW,
}

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('quiet household (recent review, nothing else) → no insights; actions always present', () => {
  const recent = new Date(NOW - 30 * 86400000).toISOString()
  const r = buildAdvisor({ ...base, reviews: [{ created_at: recent }] })
  assert.equal(r.insights.length, 0)
  assert.equal(r.actions.length, 3)
  assert.ok(r.actions.every((a) => a.href.includes('hh-1')))
  assert.equal(topInsight(r), null)
})

t('household with no review on file → single review-due insight', () => {
  const r = buildAdvisor(base)
  assert.deepEqual(r.insights.map((i) => i.id), ['no-review'])
})

t('conversion deadline within 30 days → high severity', () => {
  const iso = new Date(NOW + 20 * 86400000).toISOString()
  const r = buildAdvisor({ ...base, policies: [{ is_with_us: true, is_security: false, status: 'active', conversion_deadline: iso }] })
  const conv = r.insights.find((i) => i.id === 'conversion-window')
  assert.ok(conv, 'conversion insight present')
  assert.equal(conv.severity, 'high')
  assert.match(conv.text, /20 days/)
})

t('securities policy is excluded from the conversion signal (firewall)', () => {
  const iso = new Date(NOW + 10 * 86400000).toISOString()
  const r = buildAdvisor({ ...base, policies: [{ is_with_us: true, is_security: true, status: 'active', conversion_deadline: iso }] })
  assert.equal(r.insights.find((i) => i.id === 'conversion-window'), undefined)
})

t('held-away active policy → cross-sell insight', () => {
  const r = buildAdvisor({ ...base, policies: [{ is_with_us: false, is_security: false, status: 'active', conversion_deadline: null }] })
  assert.ok(r.insights.find((i) => i.id === 'held-away'))
})

t('spouse on file → coverage discussion insight (not a product rec)', () => {
  const r = buildAdvisor({ ...base, members: [{ relationship: 'Spouse' }] })
  const s = r.insights.find((i) => i.id === 'spouse-coverage')
  assert.ok(s)
  assert.doesNotMatch(s.text, /\b(buy|purchase|recommend|replace|allocate)\b/i)
})

t('no reviews → review-due insight; stale review → months since', () => {
  assert.ok(buildAdvisor(base).insights.find((i) => i.id === 'no-review'))
  const old = new Date(NOW - 400 * 86400000).toISOString()
  const r = buildAdvisor({ ...base, reviews: [{ created_at: old }] })
  const stale = r.insights.find((i) => i.id === 'review-stale')
  assert.ok(stale)
  assert.match(stale.text, /13 months ago/)
})

t('recent review → no stale insight', () => {
  const recent = new Date(NOW - 30 * 86400000).toISOString()
  const r = buildAdvisor({ ...base, reviews: [{ created_at: recent }] })
  assert.equal(r.insights.find((i) => i.id === 'review-stale'), undefined)
  assert.equal(r.insights.find((i) => i.id === 'no-review'), undefined)
})

t('insights sorted high → medium → info', () => {
  const iso = new Date(NOW + 15 * 86400000).toISOString()
  const r = buildAdvisor({
    ...base,
    doNotContact: true,
    openOpportunities: 2,
    policies: [{ is_with_us: true, is_security: false, status: 'active', conversion_deadline: iso }],
  })
  const order = { high: 0, medium: 1, info: 2 }
  const sev = r.insights.map((i) => order[i.severity])
  assert.deepEqual(sev, [...sev].sort((a, b) => a - b))
  assert.equal(topInsight(r).severity, 'high')
})

t('actions are workflow-only — no product/suitability language', () => {
  const r = buildAdvisor(base)
  for (const a of r.actions) assert.doesNotMatch(a.label, /\b(buy|sell|purchase|product|annuity|policy recommendation|suitab)\b/i)
  assert.match(r.disclaimer, /not a product recommendation or suitability determination/i)
})

console.log(`\nAll ${passed} assertions passed.`)
