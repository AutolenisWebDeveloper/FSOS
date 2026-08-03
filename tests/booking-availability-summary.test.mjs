// Pure weekly-availability template interpreter (src/lib/booking/availability-summary.ts). Compiled
// with its sibling availability.ts. Proves it honors `active`, preserves multi-window per day,
// groups Sun→Sat, and reads rules the same way the engine's ruleFromRow produces them.
// Run: node tests/booking-availability-summary.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-availsum-'))
execSync(
  `npx tsc src/lib/booking/availability-summary.ts src/lib/booking/availability.ts src/lib/booking/display.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const S = require(join(out, 'availability-summary.js'))
const A = require(join(out, 'availability.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const rule = (o) => ({ weekday: 1, startTime: '09:00', endTime: '17:00', timezone: 'America/Chicago', active: true, ...o })

t('ruleFromRow (engine mapper) → summary read the SAME rule (no second interpretation)', () => {
  const row = { weekday: 2, start_time: '08:30:00', end_time: '12:00:00', timezone: 'America/Chicago', effective_start: null, effective_end: null, active: true }
  const r = A.ruleFromRow(row)
  assert.equal(r.startTime, '08:30') // sliced to HH:MM, same as slots.ts
  const days = S.describeWeeklyAvailability([r])
  assert.equal(days[2].windows[0].start, '8:30 AM')
  assert.equal(days[2].windows[0].end, '12:00 PM')
})

t('honors active — inactive rules are excluded (matches engine active !== false)', () => {
  const days = S.describeWeeklyAvailability([rule({ weekday: 1 }), rule({ weekday: 3, active: false })])
  assert.equal(days[1].windows.length, 1)
  assert.equal(days[3].windows.length, 0) // Wednesday inactive → unavailable
})

t('preserves MULTIPLE windows per weekday, ordered by start (never flattened)', () => {
  const days = S.describeWeeklyAvailability([
    rule({ weekday: 1, startTime: '13:00', endTime: '17:00' }),
    rule({ weekday: 1, startTime: '09:00', endTime: '12:00' }),
  ])
  assert.equal(days[1].windows.length, 2)
  assert.deepEqual(days[1].windows.map((w) => w.start), ['9:00 AM', '1:00 PM']) // split AM/PM kept + sorted
})

t('returns all 7 days Sun→Sat; empty days are unavailable', () => {
  const days = S.describeWeeklyAvailability([rule({ weekday: 1 })])
  assert.equal(days.length, 7)
  assert.equal(days[0].label, 'Sunday')
  assert.equal(days[0].windows.length, 0)
  assert.equal(days[1].label, 'Monday')
})

t('noon/midnight format correctly via the SHARED display formatter; summaryTimezone collapses one zone', () => {
  // Exercised through describeWeeklyAvailability, which now uses display.formatWallTime (no local dupe).
  const days = S.describeWeeklyAvailability([rule({ weekday: 0, startTime: '00:00', endTime: '12:00' })])
  assert.equal(days[0].windows[0].start, '12:00 AM')
  assert.equal(days[0].windows[0].end, '12:00 PM')
  assert.equal(S.summaryTimezone(S.describeWeeklyAvailability([rule({})])), 'America/Chicago')
})

console.log(`\nAll ${passed} assertions passed.`)
