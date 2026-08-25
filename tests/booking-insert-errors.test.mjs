// FSOS-041 — a reschedule overlap collision must surface as a clean "taken" conflict (→409),
// not an opaque 500. The reschedule mover (manage.ts) now classifies DB errors with the SAME
// shared isSlotCollision() the INSERT path uses, so BOTH race guards — 23505 (identical start,
// unique index) and 23P01 (overlapping range, GiST exclusion) — map to "taken". This proves the
// classifier contract the fix depends on. Pure, offline. Run: node tests/booking-insert-errors.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-booking-errs-'))
execSync(
  `npx tsc src/lib/booking/insert-errors.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { isSlotCollision, isMissingReasonColumnError } = require(join(out, 'insert-errors.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('isSlotCollision — both race guards are a "taken" conflict (FSOS-041)')
t('23505 unique_violation → collision', () => assert.equal(isSlotCollision({ code: '23505' }), true))
t('23P01 exclusion_violation (overlap) → collision', () => assert.equal(isSlotCollision({ code: '23P01' }), true))
t('a non-collision error (23503 fk) is NOT a collision (still surfaces as error)', () =>
  assert.equal(isSlotCollision({ code: '23503' }), false))
t('undefined_column (42703) is NOT a collision', () => assert.equal(isSlotCollision({ code: '42703' }), false))
t('null / undefined error is NOT a collision', () => {
  assert.equal(isSlotCollision(null), false)
  assert.equal(isSlotCollision(undefined), false)
})

console.log('\nisMissingReasonColumnError stays scoped to the reason column (regression guard)')
t('PGRST204 mentioning reason → true', () =>
  assert.equal(isMissingReasonColumnError({ code: 'PGRST204', message: "Could not find the 'reason' column" }), true))
t('a different missing column is NOT masked', () =>
  assert.equal(isMissingReasonColumnError({ code: '42703', message: 'column "host_user_id" does not exist' }), false))

console.log(`\nAll ${passed} assertions passed.`)
