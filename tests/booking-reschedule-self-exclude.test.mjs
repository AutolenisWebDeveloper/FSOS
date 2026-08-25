// FSOS-042 — reschedule must NOT count the appointment being moved against itself.
// Proves the REAL availability calculator (computeSlotsForType) against an ephemeral Postgres:
// with a per-day-capacity-of-1 type and one scheduled appointment filling the day, the day is
// full — UNLESS that appointment is excluded (the reschedule case), which frees its own slot;
// excluding a DIFFERENT id leaves the day full (every OTHER appointment still counts → capacity
// is not weakened). Requires local Postgres + `postgres` user; skips cleanly otherwise.
// Run: node tests/booking-reschedule-self-exclude.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { makeShim } from './helpers/postgrest-shim.mjs'
import { buildBookingBundle } from './helpers/build-booking-bundle.mjs'

function sh(cmd) { return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }
let PGBIN = null
try {
  const base = '/usr/lib/postgresql'
  if (existsSync(base)) {
    const ver = readdirSync(base).sort().pop()
    if (ver && existsSync(`${base}/${ver}/bin/initdb`)) PGBIN = `${base}/${ver}/bin`
  }
} catch { /* ignore */ }
let canRunAsPostgres = false
try { sh('id postgres'); canRunAsPostgres = true } catch { /* ignore */ }
if (!PGBIN || !canRunAsPostgres) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  process.exit(0)
}

const D = '/tmp/fsos-booking-selfx'
const L = '/tmp/fsos-booking-selfxlog'
const P = '55467'
const SELF = 'aaaaaaaa-1111-1111-1111-111111111111'
const OTHER = 'bbbbbbbb-2222-2222-2222-222222222222'
// 2026-09-14 is CDT (UTC-5): 09:00 local = 14:00Z. First 30-min slot of the day.
const SELF_START = '2026-09-14T14:00:00Z'
const SELF_END = '2026-09-14T14:30:00Z'
const RANGE_START = '2026-09-14T00:00:00Z'
const RANGE_END = '2026-09-14T23:59:59Z'
const NOW = '2026-09-13T09:00:00Z' // > 4h notice; day before

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -v ON_ERROR_STOP=1 -q -f ${path}`)
}

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Reschedule self-exclusion proof (ephemeral Postgres)')
;(async () => {
  const bundlePath = await buildBookingBundle()
  try {
    sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
    sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
    sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
    sh('sleep 2')
    sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres rtest`)

    // Minimal base schema for what migration 069 ALTERs, then apply 069 itself.
    writeFileSync(
      `${L}/fixture.sql`,
      `create extension if not exists pgcrypto;\n` +
        `create or replace function update_updated_at() returns trigger language plpgsql as 'begin new.updated_at = now(); return new; end';\n` +
        `create table households (id uuid primary key default gen_random_uuid());\n` +
        `create table reviews (id uuid primary key default gen_random_uuid());\n` +
        `create table opportunities (id uuid primary key default gen_random_uuid());\n` +
        `create table contacts (id uuid primary key default gen_random_uuid(), full_name text not null default 'x');\n` +
        `create table appointments (\n` +
        `  id uuid primary key default gen_random_uuid(),\n` +
        `  household_id uuid references households(id) on delete set null,\n` +
        `  review_id uuid references reviews(id) on delete set null,\n` +
        `  scheduled_at timestamptz,\n` +
        `  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),\n` +
        `  external_ref text, opportunity_id uuid references opportunities(id) on delete set null,\n` +
        `  created_at timestamptz not null default now(), updated_at timestamptz not null default now()\n` +
        `);\n`,
    )
    psqlFile(`${L}/fixture.sql`)
    psqlFile('supabase/migrations/069_native_booking_availability.sql')

    // A per-day-capacity-of-1 practice-wide (null host) type, working hours every weekday, and
    // ONE scheduled appointment that fills the day.
    writeFileSync(
      `${L}/seed.sql`,
      `insert into appointment_types (slug, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_per_day, active)
         values ('review','Review',30,0,0,240,1,true);\n` +
        `insert into availability_rules (host_user_id, weekday, start_time, end_time, timezone, active)
         select null, g, '09:00', '17:00', 'America/Chicago', true from generate_series(0,6) g;\n` +
        `insert into appointments (id, starts_at, ends_at, scheduled_at, status, booked_via)
         values ('${SELF}','${SELF_START}','${SELF_END}','${SELF_START}','scheduled','native');\n`,
    )
    psqlFile(`${L}/seed.sql`)

    globalThis.__FSOS_DB__ = makeShim({ host: L, port: P, db: 'rtest' })
    const require = createRequire(import.meta.url)
    const { computeSlotsForType } = require(bundlePath)

    const common = { slug: 'review', rangeStart: RANGE_START, rangeEnd: RANGE_END, bookerTimezone: 'America/Chicago', now: NOW }

    const noExclude = await computeSlotsForType({ ...common })
    t('sanity: the calculator ran (ok)', () => assert.equal(noExclude.ok, true, JSON.stringify(noExclude)))
    t('WITHOUT exclusion the day is FULL (self counts against capacity) — the bug condition', () => {
      assert.equal(noExclude.slots.length, 0, `expected 0 slots, got ${noExclude.slots.length}`)
    })

    const selfExcluded = await computeSlotsForType({ ...common, excludeAppointmentId: SELF })
    t('WITH self excluded the day frees up (FSOS-042 fixed)', () => {
      assert.ok(selfExcluded.slots.length > 0, 'self-exclusion should free the day')
    })
    t('and the appointment’s OWN slot is offered again', () => {
      const want = new Date(SELF_START).getTime()
      assert.ok(
        selfExcluded.slots.some((s) => new Date(s.startsAt).getTime() === want),
        `own slot ${SELF_START} should be bookable; got ${selfExcluded.slots.map((s) => s.startsAt).slice(0, 5)}`,
      )
    })

    const otherExcluded = await computeSlotsForType({ ...common, excludeAppointmentId: OTHER })
    t('excluding a DIFFERENT id does NOT free the day (capacity still enforced against others)', () => {
      assert.equal(otherExcluded.slots.length, 0, 'only the appointment being moved may be excluded')
    })

    console.log(`\nAll ${passed} assertions passed.`)
  } finally {
    try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop -m immediate > /dev/null 2>&1`) } catch { /* ignore */ }
    sh(`rm -rf ${D} ${L}`)
  }
})().catch((e) => { console.error('\nHARNESS ERROR:', e && e.stack ? e.stack : e); process.exit(1) })
