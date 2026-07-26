// Native booking — FSA config validation proof (src/lib/booking/config-schemas.ts).
// Compiles the schema module in isolation and asserts the Zod contracts + cross-field
// rules that guard every write route (bad slug, out-of-range duration, end<=start,
// invalid IANA zone, blackout end<=start, etc.). config-schemas imports only `zod`, so we
// compile into a repo-local cache dir where Node can resolve it from node_modules.
// Run: node tests/booking-config.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const cache = join(process.cwd(), 'node_modules', '.cache')
mkdirSync(cache, { recursive: true })
const out = mkdtempSync(join(cache, 'fsos-bookcfg-'))
try {
  execSync(
    `npx tsc src/lib/booking/config-schemas.ts --outDir ${out} --rootDir src/lib/booking ` +
      `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'inherit' },
  )
  const require = createRequire(import.meta.url)
  const {
    AppointmentTypeCreate,
    AppointmentTypeUpdate,
    AvailabilityRuleCreate,
    AvailabilityRuleUpdate,
    BlackoutCreate,
    isValidIanaZone,
    availabilityRuleIssues,
    MEETING_MODES,
  } = require(join(out, 'config-schemas.js'))

  let passed = 0
  const t = (name, fn) => {
    fn()
    passed++
    console.log('  ✓', name)
  }

  console.log('isValidIanaZone')
  t('accepts real zones, rejects junk', () => {
    assert.equal(isValidIanaZone('America/Chicago'), true)
    assert.equal(isValidIanaZone('UTC'), true)
    assert.equal(isValidIanaZone('Not/AZone'), false)
    assert.equal(isValidIanaZone(''), false)
    assert.equal(isValidIanaZone(42), false)
  })

  console.log('AppointmentTypeCreate')
  t('a minimal valid type parses and applies defaults', () => {
    const r = AppointmentTypeCreate.safeParse({ name: 'Intro call', slug: 'intro-call', duration_minutes: 30 })
    assert.ok(r.success)
    assert.equal(r.data.buffer_before_minutes, 0)
    assert.equal(r.data.min_notice_minutes, 240)
    assert.equal(r.data.max_lead_days, 60)
    assert.equal(r.data.slot_interval_minutes, 30)
    assert.equal(r.data.meeting_mode, 'video')
    assert.equal(r.data.active, true)
  })
  t('rejects a bad slug, a too-short duration, and a negative buffer', () => {
    assert.equal(AppointmentTypeCreate.safeParse({ name: 'x', slug: 'Bad Slug', duration_minutes: 30 }).success, false)
    assert.equal(AppointmentTypeCreate.safeParse({ name: 'x', slug: 'ok', duration_minutes: 2 }).success, false)
    assert.equal(
      AppointmentTypeCreate.safeParse({ name: 'x', slug: 'ok', duration_minutes: 30, buffer_before_minutes: -5 }).success,
      false,
    )
  })
  t('rejects an unknown meeting_mode; accepts each valid one', () => {
    assert.equal(AppointmentTypeCreate.safeParse({ name: 'x', slug: 'ok', duration_minutes: 30, meeting_mode: 'telepathy' }).success, false)
    for (const m of MEETING_MODES) {
      assert.equal(AppointmentTypeCreate.safeParse({ name: 'x', slug: 'ok', duration_minutes: 30, meeting_mode: m }).success, true)
    }
  })
  t('max_per_day is optional/nullable but positive when present', () => {
    assert.equal(AppointmentTypeCreate.safeParse({ name: 'x', slug: 'ok', duration_minutes: 30, max_per_day: null }).success, true)
    assert.equal(AppointmentTypeCreate.safeParse({ name: 'x', slug: 'ok', duration_minutes: 30, max_per_day: 3 }).success, true)
    assert.equal(AppointmentTypeCreate.safeParse({ name: 'x', slug: 'ok', duration_minutes: 30, max_per_day: 0 }).success, false)
  })
  t('update is a partial patch (empty object is valid)', () => {
    assert.equal(AppointmentTypeUpdate.safeParse({}).success, true)
    assert.equal(AppointmentTypeUpdate.safeParse({ active: false }).success, true)
    assert.equal(AppointmentTypeUpdate.safeParse({ duration_minutes: 1 }).success, false)
  })

  console.log('AvailabilityRuleCreate')
  t('a valid weekly window parses with the default timezone', () => {
    const r = AvailabilityRuleCreate.safeParse({ weekday: 1, start_time: '09:00', end_time: '17:00' })
    assert.ok(r.success)
    assert.equal(r.data.timezone, 'America/Chicago')
    assert.equal(r.data.active, true)
  })
  t('rejects end<=start, a bad HH:MM, an out-of-range weekday, and an invalid zone', () => {
    assert.equal(AvailabilityRuleCreate.safeParse({ weekday: 1, start_time: '17:00', end_time: '09:00' }).success, false)
    assert.equal(AvailabilityRuleCreate.safeParse({ weekday: 1, start_time: '9:00', end_time: '17:00' }).success, false)
    assert.equal(AvailabilityRuleCreate.safeParse({ weekday: 9, start_time: '09:00', end_time: '17:00' }).success, false)
    assert.equal(
      AvailabilityRuleCreate.safeParse({ weekday: 1, start_time: '09:00', end_time: '17:00', timezone: 'Mars/Base' }).success,
      false,
    )
  })
  t('rejects effective_end before effective_start', () => {
    const r = AvailabilityRuleCreate.safeParse({
      weekday: 1,
      start_time: '09:00',
      end_time: '17:00',
      effective_start: '2026-06-01',
      effective_end: '2026-05-01',
    })
    assert.equal(r.success, false)
  })
  t('availabilityRuleIssues flags both cross-field problems purely', () => {
    assert.deepEqual(availabilityRuleIssues({ start_time: '10:00', end_time: '10:00' }), ['end_time must be after start_time'])
    assert.equal(availabilityRuleIssues({ start_time: '09:00', end_time: '17:00' }).length, 0)
    assert.equal(availabilityRuleIssues({ effective_start: '2026-02-01', effective_end: '2026-01-01' }).length, 1)
  })
  t('rule update partial still enforces cross-field when both present', () => {
    assert.equal(AvailabilityRuleUpdate.safeParse({ active: false }).success, true)
    assert.equal(AvailabilityRuleUpdate.safeParse({ start_time: '17:00', end_time: '09:00' }).success, false)
  })

  console.log('BlackoutCreate')
  t('a valid blackout parses; end<=start and bad datetimes are rejected', () => {
    assert.equal(
      BlackoutCreate.safeParse({ starts_at: '2026-08-03T14:00:00Z', ends_at: '2026-08-03T15:00:00Z' }).success,
      true,
    )
    assert.equal(
      BlackoutCreate.safeParse({ starts_at: '2026-08-03T15:00:00Z', ends_at: '2026-08-03T14:00:00Z' }).success,
      false,
    )
    assert.equal(BlackoutCreate.safeParse({ starts_at: 'not-a-date', ends_at: '2026-08-03T15:00:00Z' }).success, false)
  })

  console.log(`\nAll ${passed} assertions passed.`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
