// Pure booking-config history mapping (src/lib/booking/config-history.ts). DB-free; compiled with
// its type-only sibling comms/timeline.ts. Run: node tests/booking-config-history.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-cfghist-'))
execSync(
  `npx tsc src/lib/booking/config-history.ts src/lib/comms/timeline.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const H = require(join(out, 'booking/config-history.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('describeConfigChange labels each entity + verb from the config.ts diff shapes', () => {
  assert.equal(H.describeConfigChange('appointment_type', { created: 'Intro call' }), 'Appointment type added')
  assert.equal(H.describeConfigChange('appointment_type', { updated: ['duration_minutes'] }), 'Appointment type updated')
  assert.equal(H.describeConfigChange('appointment_type', { deleted: true }), 'Appointment type removed')
  assert.equal(H.describeConfigChange('availability_rule', { weekday: 2 }), 'Weekly hours added')
  assert.equal(H.describeConfigChange('availability_blackout', { starts_at: '2026-08-10' }), 'Blackout added')
  assert.equal(H.describeConfigChange('availability_blackout', { deleted: true }), 'Blackout removed')
})

t('describeConfigChange falls back gracefully for unknown entity/diff', () => {
  assert.equal(H.describeConfigChange('something_else', null), 'Scheduling setting changed')
  assert.equal(H.describeConfigChange('appointment_type', {}), 'Appointment type changed')
})

t('toTimelineEntry produces a well-formed audit TimelineEntry (no bodies/PII)', () => {
  const e = H.toTimelineEntry({ id: 42, actor: 'fsa@x.com', entity: 'availability_rule', diff: { updated: ['start_time'] }, at: '2026-08-03T10:00:00Z' })
  assert.equal(e.id, 'audit:42')
  assert.equal(e.source, 'audit')
  assert.equal(e.title, 'Weekly hours updated')
  assert.equal(e.actor, 'fsa@x.com')
  assert.equal(e.at, '2026-08-03T10:00:00Z')
  assert.equal(e.body, null)
  assert.equal(e.recipient, null)
  assert.equal(e.providerId, null)
  assert.equal(e.status, null)
})

console.log(`\nAll ${passed} assertions passed.`)
