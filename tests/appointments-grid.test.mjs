// Pure week-grid + navigation date math (src/lib/appointments/grid.ts). DB-free, clock-free.
// Run: node tests/appointments-grid.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-apptgrid-'))
execSync(
  `npx tsc src/lib/appointments/grid.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const G = require(join(out, 'grid.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('weekdayOf matches the known calendar (2026-08-03 is a Monday)', () => {
  assert.equal(G.weekdayOf('2026-08-03'), 1)
  assert.equal(G.weekdayOf('2026-08-02'), 0) // Sunday
})

t('addDaysKey crosses month and year boundaries in UTC', () => {
  assert.equal(G.addDaysKey('2026-08-31', 1), '2026-09-01')
  assert.equal(G.addDaysKey('2026-01-01', -1), '2025-12-31')
  assert.equal(G.addDaysKey('2026-08-03', 7), '2026-08-10')
})

t('buildWeekDays returns the Sunday-start week containing the anchor', () => {
  const week = G.buildWeekDays('2026-08-03') // Monday
  assert.equal(week.length, 7)
  assert.equal(week[0], '2026-08-02') // Sunday
  assert.equal(week[6], '2026-08-08') // Saturday
  assert.ok(week.includes('2026-08-03'))
  // An anchor that is already Sunday returns itself first.
  assert.equal(G.buildWeekDays('2026-08-02')[0], '2026-08-02')
})

t('addMonths normalizes across year boundaries both directions', () => {
  assert.deepEqual(G.addMonths(2026, 11, 1), { year: 2027, month0: 0 }) // Dec → Jan next year
  assert.deepEqual(G.addMonths(2026, 0, -1), { year: 2025, month0: 11 }) // Jan → Dec prev year
  assert.deepEqual(G.addMonths(2026, 7, 0), { year: 2026, month0: 7 })
})

console.log(`\nAll ${passed} assertions passed.`)
