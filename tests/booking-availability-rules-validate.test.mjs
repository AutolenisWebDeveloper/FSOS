// Pure availability rule-set validation + orphan detection (availability-rules-validate.ts),
// compiled with availability.ts + timezone.ts. Proves: overlaps are DETECTED but ADVISORY (matched
// to the engine's union contract), and the "outside template" check reuses the shared containment
// predicate. Run: node tests/booking-availability-rules-validate.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-availval-'))
execSync(
  `npx tsc src/lib/booking/availability-rules-validate.ts src/lib/booking/availability.ts src/lib/booking/timezone.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const V = require(join(out, 'availability-rules-validate.js'))
const A = require(join(out, 'availability.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const TZ = 'America/Chicago'
const rule = (o) => ({ weekday: 1, startTime: '09:00', endTime: '17:00', timezone: TZ, active: true, effectiveStart: null, effectiveEnd: null, ...o })

t('validateAvailabilityRules flags same-weekday overlapping windows (advisory, not fatal)', () => {
  const res = V.validateAvailabilityRules([rule({ startTime: '09:00', endTime: '12:00' }), rule({ startTime: '11:00', endTime: '14:00' })])
  assert.equal(res.overlaps.length, 1)
  assert.equal(res.overlaps[0].weekday, 1)
})

t('adjacent (touching) windows do NOT overlap; different weekdays do NOT overlap', () => {
  assert.equal(V.validateAvailabilityRules([rule({ startTime: '09:00', endTime: '12:00' }), rule({ startTime: '12:00', endTime: '15:00' })]).overlaps.length, 0)
  assert.equal(V.validateAvailabilityRules([rule({ weekday: 1 }), rule({ weekday: 2 })]).overlaps.length, 0)
})

t('cross-timezone same-weekday pairs are skipped (wall times not comparable; engine UTC-dedupes)', () => {
  const res = V.validateAvailabilityRules([rule({ timezone: 'America/Chicago' }), rule({ timezone: 'America/New_York' })])
  assert.equal(res.overlaps.length, 0)
})

t('isInstantWithinTemplate: inside Monday 9–5 CDT is within; Sunday / after-hours is outside', () => {
  const rules = [rule({ weekday: 1, startTime: '09:00', endTime: '17:00' })]
  // 2026-08-03 is a Monday. 15:00Z = 10:00 CDT → within.
  assert.equal(A.isInstantWithinTemplate(Date.parse('2026-08-03T15:00:00Z'), rules), true)
  // 2026-08-03 02:00Z = 2026-08-02 21:00 CDT (Sunday) → outside (no Sunday rule).
  assert.equal(A.isInstantWithinTemplate(Date.parse('2026-08-03T02:00:00Z'), rules), false)
  // Monday 23:00Z = 18:00 CDT → after 17:00 end (end-exclusive) → outside.
  assert.equal(A.isInstantWithinTemplate(Date.parse('2026-08-03T23:00:00Z'), rules), false)
})

t('appointmentsOutsideTemplate returns only the appts outside; skips null/bad starts', () => {
  const rules = [rule({ weekday: 1, startTime: '09:00', endTime: '17:00' })]
  const appts = [
    { id: 'in', starts_at: '2026-08-03T15:00:00Z' }, // Mon 10:00 CDT → within
    { id: 'out', starts_at: '2026-08-03T23:00:00Z' }, // Mon 18:00 CDT → outside
    { id: 'null', starts_at: null }, // skipped
    { id: 'bad', starts_at: 'not-a-date' }, // skipped
  ]
  const outside = V.appointmentsOutsideTemplate(appts, rules)
  assert.deepEqual(outside.map((a) => a.id), ['out'])
})

console.log(`\nAll ${passed} assertions passed.`)
