// Relationship Intelligence classifier (pure, redesign spec §10). Verifies
// free-text relationships map to canonical roles, entity roles (business/trust)
// win over person roles, and grouping is ordered with empty roles omitted.
// Run: node tests/contact-relationships.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-rel-'))
execSync(
  `npx tsc src/lib/contacts/relationships.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { classifyRelationship, groupByRole, ROLE_META } = require(join(out, 'relationships.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('primary owner variants', () => {
  for (const r of ['Primary', 'Owner', 'Primary Owner', 'Policyholder', 'Self']) assert.equal(classifyRelationship(r), 'primary')
})

t('joint owner / spouse → joint (never primary)', () => {
  for (const r of ['Joint Owner', 'Joint', 'Spouse', 'Co-owner', 'Husband', 'Wife']) assert.equal(classifyRelationship(r), 'joint')
})

t('dependents', () => {
  for (const r of ['Child', 'Son', 'Daughter', 'Dependent', 'Minor']) assert.equal(classifyRelationship(r), 'dependent')
})

t('beneficiary', () => {
  assert.equal(classifyRelationship('Beneficiary'), 'beneficiary')
})

t('entities win over person roles', () => {
  assert.equal(classifyRelationship('Family Trust'), 'trust')
  assert.equal(classifyRelationship('Acme LLC'), 'business')
  // A business-owner should classify as the entity, not "owner"/primary.
  assert.equal(classifyRelationship('Business Owner'), 'business')
})

t('empty / unknown → other', () => {
  assert.equal(classifyRelationship(null), 'other')
  assert.equal(classifyRelationship(''), 'other')
  assert.equal(classifyRelationship('Neighbor'), 'other')
})

t('name can inform classification when relationship is blank', () => {
  assert.equal(classifyRelationship(null, 'Smith Family Trust'), 'trust')
})

t('groupByRole is ordered and omits empty roles', () => {
  const members = [
    { relationship: 'Child', full_name: 'Kid A' },
    { relationship: 'Primary', full_name: 'Head' },
    { relationship: 'Spouse', full_name: 'Partner' },
  ]
  const groups = groupByRole(members)
  assert.deepEqual(groups.map((g) => g.meta.key), ['primary', 'joint', 'dependent'])
  assert.equal(groups.every((g) => g.members.length > 0), true)
  assert.equal(ROLE_META.business.entity, true)
  assert.equal(ROLE_META.primary.entity, false)
})

console.log(`\nAll ${passed} assertions passed.`)
