// Public booking step model (src/components/public/booking/step-model.ts) — pure, DB-free.
// Compiles the module in isolation and proves the step derivation the on-screen stepper and
// the rendered flow both depend on. Run: node tests/booking-step-model.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-stepmodel-'))
execSync(
  `npx tsc src/components/public/booking/step-model.ts --outDir ${out} --module commonjs ` +
    `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { deriveStep, stepIndex, completedSteps, stepLabel, BOOKING_STEPS } = require(join(out, 'step-model.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('deriveStep walks type → slot → details → review → confirmed', () => {
  assert.equal(deriveStep({ hasType: false, hasSlot: false, reviewing: false, confirmed: false }), 'type')
  assert.equal(deriveStep({ hasType: true, hasSlot: false, reviewing: false, confirmed: false }), 'slot')
  assert.equal(deriveStep({ hasType: true, hasSlot: true, reviewing: false, confirmed: false }), 'details')
  assert.equal(deriveStep({ hasType: true, hasSlot: true, reviewing: true, confirmed: false }), 'review')
  assert.equal(deriveStep({ hasType: true, hasSlot: true, reviewing: true, confirmed: true }), 'confirmed')
})

t('confirmed always wins, even if earlier gates are false', () => {
  assert.equal(deriveStep({ hasType: false, hasSlot: false, reviewing: false, confirmed: true }), 'confirmed')
})

t('completedSteps returns the steps strictly before current', () => {
  assert.deepEqual(completedSteps('type'), [])
  assert.deepEqual(completedSteps('details'), ['type', 'slot'])
  assert.deepEqual(completedSteps('confirmed'), ['type', 'slot', 'details', 'review'])
})

t('stepIndex + labels are consistent with the canonical order', () => {
  assert.equal(stepIndex('type'), 0)
  assert.equal(stepIndex('confirmed'), 4)
  assert.equal(BOOKING_STEPS.length, 5)
  for (const s of BOOKING_STEPS) assert.equal(typeof stepLabel(s), 'string')
  assert.ok(stepLabel('slot').length > 0)
})

console.log(`\nAll ${passed} assertions passed.`)
