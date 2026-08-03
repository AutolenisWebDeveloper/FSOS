// Pure booking-analytics aggregations (src/lib/appointments/analytics.ts), compiled with recovery.ts.
// Run: node tests/appointments-analytics.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-apptanalytics-'))
execSync(
  `npx tsc src/lib/appointments/analytics.ts src/lib/appointments/recovery.ts --outDir ${out} ` +
    `--rootDir src/lib/appointments --module commonjs --target es2020 --moduleResolution node ` +
    `--skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const A = require(join(out, 'analytics.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const NOW = Date.parse('2026-08-03T12:00:00Z')
const appt = (o) => ({ id: o.id, household_id: null, opportunity_id: null, scheduled_at: null, starts_at: null, status: 'scheduled', booked_via: null, meeting_mode: null, reminder_sent_at: null, ...o })

t('bookedViaBreakdown maps null→manual and keeps a stable ordering with percents', () => {
  const b = A.bookedViaBreakdown([appt({ id: '1', booked_via: 'native' }), appt({ id: '2', booked_via: null }), appt({ id: '3', booked_via: 'native' }), appt({ id: '4', booked_via: 'legacy_calendly' })])
  const native = b.find((x) => x.key === 'native')
  assert.equal(native.count, 2)
  assert.equal(native.pct, 50) // 2 of 4
  assert.equal(b.find((x) => x.key === 'manual').count, 1) // the null
  assert.equal(b[0].key, 'native') // stable order
})

t('meetingModeBreakdown buckets unset separately', () => {
  const m = A.meetingModeBreakdown([appt({ id: '1', meeting_mode: 'video' }), appt({ id: '2', meeting_mode: null })])
  assert.equal(m.find((x) => x.key === 'video').count, 1)
  assert.equal(m.find((x) => x.key === 'unset').count, 1)
})

t('reminderCoverage counts only PAST non-cancelled appointments', () => {
  const appts = [
    appt({ id: 'past-reminded', starts_at: '2026-08-01T10:00:00Z', reminder_sent_at: '2026-07-31T10:00:00Z' }),
    appt({ id: 'past-not', starts_at: '2026-08-02T10:00:00Z' }),
    appt({ id: 'future', starts_at: '2026-08-10T10:00:00Z', reminder_sent_at: null }), // not eligible (future)
    appt({ id: 'cancelled', status: 'cancelled', starts_at: '2026-08-01T10:00:00Z' }), // excluded
  ]
  const r = A.reminderCoverage(appts, NOW)
  assert.equal(r.eligible, 2)
  assert.equal(r.reminded, 1)
  assert.equal(r.pct, 50)
})

t('notificationStats: delivered% over attempted (excl queued); open/click deduped by message; 0 not NaN', () => {
  const messages = [
    { id: 'm1', delivery_status: 'delivered' },
    { id: 'm2', delivery_status: 'delivered' },
    { id: 'm3', delivery_status: 'failed' },
    { id: 'm4', delivery_status: 'queued' },
    { id: 'm5', delivery_status: 'blocked' },
  ]
  const events = [
    { message_id: 'm1', event: 'opened' },
    { message_id: 'm1', event: 'opened' }, // dup — must not inflate
    { message_id: 'm2', event: 'clicked' },
    { message_id: null, event: 'opened' }, // ignored
  ]
  const s = A.notificationStats(messages, events)
  assert.equal(s.total, 5)
  assert.equal(s.delivered, 2)
  assert.equal(s.failed, 1)
  assert.equal(s.blocked, 1)
  // attempted = 5 − 1 queued = 4; delivered 2 → 50%
  assert.equal(s.deliveredPct, 50)
  assert.equal(s.openPct, 50) // 1 distinct opened message ÷ 2 delivered
  assert.equal(s.clickPct, 50) // 1 clicked ÷ 2 delivered
  // empty inputs → zeros, never NaN
  const z = A.notificationStats([], [])
  assert.equal(z.deliveredPct, 0)
  assert.equal(z.openPct, 0)
})

console.log(`\nAll ${passed} assertions passed.`)
