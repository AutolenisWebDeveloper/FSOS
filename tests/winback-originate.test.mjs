// Life Win-Back opportunity origination gate — proves the PURE planner
// (lib/opportunities/winback.ts): a former life client (imported win-back contact
// tagged 'life-winback') becomes an explainable, deduplicated win_back opportunity
// DRAFT; a contact that already has an open win_back opportunity is never duplicated;
// a non-life-winback or already-worked contact is skipped; and every draft is
// is_security=false (win-back is never a securities target). Compiles the pure module
// in isolation (no Supabase). Run: node tests/winback-originate.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-winback-'))
execSync(
  `npx tsc src/lib/opportunities/winback.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  hadLife,
  isEligibleWinback,
  engagementForContact,
  winbackReason,
  planWinbackOpportunities,
  WIN_BACK_SOURCE,
  LIFE_WINBACK_TAG,
} = require(join(out, 'winback.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

function contact(over = {}) {
  return {
    id: 'c-' + Math.random().toString(36).slice(2),
    full_name: 'Dana Cole',
    tags: ['win-back', 'life-winback'],
    lines_of_business: ['life', 'auto'],
    agency_partnership_id: 'ag-1',
    household_id: null,
    status: 'active',
    ...over,
  }
}

console.log('Eligibility (hadLife / isEligibleWinback)')

t('a contact tagged life-winback had life', () => {
  assert.equal(hadLife(contact()), true)
  assert.equal(hadLife(contact({ tags: ['win-back'] })), false)
  assert.equal(hadLife(contact({ tags: null })), false)
})

t('an active life-winback contact is eligible', () => {
  assert.equal(isEligibleWinback(contact()), true)
})

t('a non-life-winback contact is not eligible (P&C-only win-back is out of scope here)', () => {
  assert.equal(isEligibleWinback(contact({ tags: ['win-back'] })), false)
})

t('an already-worked (archived) contact is not eligible', () => {
  assert.equal(isEligibleWinback(contact({ status: 'archived' })), false)
})

t('a contact with no id is not eligible', () => {
  assert.equal(isEligibleWinback(contact({ id: '' })), false)
})

console.log('Engagement + reason')

t('an agency-attributed contact is co_sell; an unattributed one is direct', () => {
  assert.equal(engagementForContact(contact({ agency_partnership_id: 'ag-1' })), 'co_sell')
  assert.equal(engagementForContact(contact({ agency_partnership_id: null })), 'direct')
})

t('the reason is grounded in the win-back list and never claims a current policy', () => {
  const r = winbackReason(contact({ lines_of_business: ['life', 'auto'] }))
  assert.match(r, /win-back/i)
  // must not imply an active/current policy or a carrier fact (§13.2, §4.3)
  assert.doesNotMatch(r, /active policy|current policy|in force|carrier/i)
})

console.log('Planning (planWinbackOpportunities) — dedup + firewall')

t('an eligible contact with no existing opp produces one prospect draft attributed to the contact', () => {
  const c = contact()
  const { drafts, skipped } = planWinbackOpportunities([c], [])
  assert.equal(drafts.length, 1)
  assert.equal(skipped.length, 0)
  assert.equal(drafts[0].contact_id, c.id)
  assert.equal(drafts[0].stage, 'prospect')
  assert.equal(drafts[0].source, WIN_BACK_SOURCE)
  assert.equal(drafts[0].product_id, null)
  assert.equal(drafts[0].referring_agency_id, 'ag-1')
})

t('every draft is is_security=false — win-back is never a securities target (firewall)', () => {
  const { drafts } = planWinbackOpportunities([contact(), contact(), contact()], [])
  assert.ok(drafts.length > 0)
  assert.ok(drafts.every((d) => d.is_security === false))
})

t('a contact with an OPEN win_back opp is not duplicated', () => {
  const c = contact({ id: 'c-dup' })
  const existing = [{ contact_id: 'c-dup', source: 'win_back', stage: 'fact_find' }]
  const { drafts, skipped } = planWinbackOpportunities([c], existing)
  assert.equal(drafts.length, 0)
  assert.equal(skipped[0].reason, 'duplicate_open')
})

t('a contact whose only win_back opp is terminal (lost/placed) CAN be re-originated', () => {
  const c = contact({ id: 'c-lost' })
  const existing = [
    { contact_id: 'c-lost', source: 'win_back', stage: 'lost' },
    { contact_id: 'c-lost', source: 'win_back', stage: 'placed_issued' },
  ]
  const { drafts } = planWinbackOpportunities([c], existing)
  assert.equal(drafts.length, 1)
})

t('an open opportunity from a DIFFERENT source does not block win-back origination', () => {
  const c = contact({ id: 'c-x' })
  const existing = [{ contact_id: 'c-x', source: 'cross_sell', stage: 'quoted_proposed' }]
  const { drafts } = planWinbackOpportunities([c], existing)
  assert.equal(drafts.length, 1)
})

t('two rows for the same contact in one batch only draft once', () => {
  const { drafts, skipped } = planWinbackOpportunities(
    [contact({ id: 'c-same' }), contact({ id: 'c-same' })],
    [],
  )
  assert.equal(drafts.length, 1)
  assert.equal(skipped.filter((s) => s.reason === 'duplicate_open').length, 1)
})

t('an ineligible contact is skipped with a not_eligible reason', () => {
  const { drafts, skipped } = planWinbackOpportunities([contact({ tags: ['win-back'] })], [])
  assert.equal(drafts.length, 0)
  assert.equal(skipped[0].reason, 'not_eligible')
})

t('LIFE_WINBACK_TAG is the documented life-winback tag', () => {
  assert.equal(LIFE_WINBACK_TAG, 'life-winback')
})

console.log(`\nAll ${passed} assertions passed.`)
