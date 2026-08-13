// Rename an existing campaign — proves the CampaignPatchSchema edit contract offline.
// A rename PATCHes only the human-facing name; the schema rejects empty updates, blank
// names, and over-long names, and trims whitespace. No DB, no clock.
// Runs under tsx (the runner invokes `npx tsx` for .mts) so it imports the TS source
// directly — no fragile standalone tsc invocation.
// Run: npx tsx tests/comms-campaign-rename.test.mts
import assert from 'node:assert/strict'
import { CampaignPatchSchema } from '../src/lib/validation/schemas'

let passed = 0
const t = (name: string, fn: () => void) => { fn(); passed++; console.log('  ✓', name) }

console.log('CampaignPatchSchema — rename contract')

t('a valid new name is accepted', () => {
  const r = CampaignPatchSchema.safeParse({ name: 'Q4 Life Conversion — West' })
  assert.ok(r.success)
  assert.equal(r.data.name, 'Q4 Life Conversion — West')
})

t('surrounding whitespace is trimmed', () => {
  const r = CampaignPatchSchema.safeParse({ name: '  Renamed campaign  ' })
  assert.ok(r.success)
  assert.equal(r.data.name, 'Renamed campaign')
})

t('an empty update (no fields) is rejected — nothing to change', () => {
  assert.ok(!CampaignPatchSchema.safeParse({}).success)
})

t('a blank / whitespace-only name is rejected', () => {
  assert.ok(!CampaignPatchSchema.safeParse({ name: '' }).success)
  assert.ok(!CampaignPatchSchema.safeParse({ name: '   ' }).success)
})

t('a name over 160 chars is rejected; exactly 160 is accepted', () => {
  assert.ok(!CampaignPatchSchema.safeParse({ name: 'x'.repeat(161) }).success)
  assert.ok(CampaignPatchSchema.safeParse({ name: 'x'.repeat(160) }).success)
})

t('unknown fields do not leak through (name is the only editable field)', () => {
  const r = CampaignPatchSchema.safeParse({ name: 'Kept', status: 'active', template_id: 'x' })
  assert.ok(r.success)
  assert.equal((r.data as Record<string, unknown>).status, undefined)
  assert.equal((r.data as Record<string, unknown>).template_id, undefined)
})

console.log(`\n${passed} assertions passed.`)
