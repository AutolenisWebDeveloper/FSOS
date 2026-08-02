// Public booking month-grid (src/components/public/booking/month-grid.ts) — pure, DB-free.
// Compiles in isolation and proves the calendar layout + day classification the month picker
// relies on. Run: node tests/booking-month-grid.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-monthgrid-'))
execSync(
  `npx tsc src/components/public/booking/month-grid.ts --outDir ${out} --module commonjs ` +
    `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { buildMonthMatrix, dayState, groupSlotsByDay, daysInMonth, firstWeekday } = require(join(out, 'month-grid.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('buildMonthMatrix is always a 6x7 Sunday-start grid', () => {
  const m = buildMonthMatrix(2026, 7) // August 2026 (month0=7)
  assert.equal(m.length, 6)
  assert.ok(m.every((r) => r.length === 7))
  // Aug 1 2026 is a Saturday → six leading filler cells (Sun..Fri) from July.
  assert.equal(firstWeekday(2026, 7), 6)
  assert.equal(m[0][6].dateKey, '2026-08-01')
  assert.equal(m[0][6].inMonth, true)
  assert.equal(m[0][0].dateKey, '2026-07-26')
  assert.equal(m[0][0].inMonth, false)
})

t('month length + leap year handled', () => {
  assert.equal(daysInMonth(2026, 7), 31) // August
  assert.equal(daysInMonth(2026, 1), 28) // Feb 2026
  assert.equal(daysInMonth(2028, 1), 29) // Feb 2028 (leap)
  const feb = buildMonthMatrix(2026, 1)
  const feb28 = feb.flat().find((c) => c.dateKey === '2026-02-28')
  assert.equal(feb28.inMonth, true)
  assert.ok(!feb.flat().some((c) => c.dateKey === '2026-02-29'))
})

t('trailing cells roll into the next month/year', () => {
  const dec = buildMonthMatrix(2026, 11) // December 2026
  assert.ok(dec.flat().some((c) => c.dateKey.startsWith('2027-01') && !c.inMonth))
})

t('dayState classifies past / available / unavailable via padded string compare', () => {
  const avail = new Set(['2026-08-03', '2026-08-10'])
  assert.equal(dayState('2026-08-02', avail, '2026-08-03'), 'past')
  assert.equal(dayState('2026-08-03', avail, '2026-08-03'), 'available')
  assert.equal(dayState('2026-08-04', avail, '2026-08-03'), 'unavailable')
  assert.equal(dayState('2026-08-10', avail, '2026-08-03'), 'available')
})

t('groupSlotsByDay buckets by the server-provided localDate', () => {
  const g = groupSlotsByDay([
    { localDate: '2026-08-03', startsAt: 'a' },
    { localDate: '2026-08-03', startsAt: 'b' },
    { localDate: '2026-08-04', startsAt: 'c' },
  ])
  assert.equal(g.get('2026-08-03').length, 2)
  assert.equal(g.get('2026-08-04').length, 1)
  assert.equal(g.has('2026-08-05'), false)
})

console.log(`\nAll ${passed} assertions passed.`)
