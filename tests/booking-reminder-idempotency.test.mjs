// Native booking — reminder idempotency proof (Slice 5). Stands up an ephemeral Postgres,
// applies a minimal fixture + migration 069, and proves the atomic `reminder_sent_at` claim
// (`UPDATE … SET reminder_sent_at=now WHERE id=? AND reminder_sent_at IS NULL RETURNING id`)
// sends at most once: the first claim returns a row, a concurrent/repeat claim returns none,
// and releasing the claim (reset to null) lets a later tick re-claim. This is the DB
// guarantee runBookingReminderPass relies on so overlapping cron ticks never double-send.
// Requires local Postgres + `postgres` OS user; skips cleanly unless CI_REQUIRE_INFRA=1.
// Run: node tests/booking-reminder-idempotency.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}
let PGBIN = null
try {
  const base = '/usr/lib/postgresql'
  if (existsSync(base)) {
    const ver = readdirSync(base).sort().pop()
    if (ver && existsSync(`${base}/${ver}/bin/initdb`)) PGBIN = `${base}/${ver}/bin`
  }
} catch {
  /* ignore */
}
let canRunAsPostgres = false
try {
  sh('id postgres')
  canRunAsPostgres = true
} catch {
  /* ignore */
}
if (!PGBIN || !canRunAsPostgres) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  process.exit(0)
}

const D = '/tmp/fsos-booking-rem'
const L = '/tmp/fsos-booking-remlog'
const P = '55459'
const HOST = '11111111-1111-1111-1111-111111111111'
const SLOT = '2026-08-10T14:00:00Z'
const END = '2026-08-10T14:30:00Z'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d remtest -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function scalar(sql) {
  const raw = sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d remtest -t -A -c ${JSON.stringify(sql)}`)
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? ''
}
// Returns the row count a claim UPDATE affected (0 or 1) using RETURNING + a COUNT wrapper.
function claim() {
  return scalar(
    `with c as (update appointments set reminder_sent_at = now() ` +
      `where id = (select id from appointments limit 1) and reminder_sent_at is null returning id) ` +
      `select count(*) from c;`,
  )
}

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('Reminder idempotency proof (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres remtest`)

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
      `  external_ref text,\n` +
      `  opportunity_id uuid references opportunities(id) on delete set null,\n` +
      `  created_at timestamptz not null default now(),\n` +
      `  updated_at timestamptz not null default now()\n` +
      `);\n`,
  )
  psqlFile(`${L}/fixture.sql`)
  psqlFile('supabase/migrations/069_native_booking_availability.sql')
  sh(
    `runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d remtest -q -c ` +
      JSON.stringify(
        `insert into appointments (host_user_id, starts_at, ends_at, scheduled_at, status, booked_via) values ('${HOST}','${SLOT}','${END}','${SLOT}','scheduled','native');`,
      ),
  )

  t('the first reminder claim wins (1 row)', () => {
    assert.equal(claim(), '1')
  })
  t('a repeat claim sends nothing (0 rows) — reminder_sent_at already set', () => {
    assert.equal(claim(), '0')
    assert.equal(scalar('select count(*) from appointments where reminder_sent_at is not null;'), '1')
  })
  t('releasing the claim lets a later tick re-claim (retry path)', () => {
    sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d remtest -q -c ${JSON.stringify('update appointments set reminder_sent_at = null;')}`)
    assert.equal(claim(), '1')
    assert.equal(claim(), '0')
  })

  console.log(`\nAll ${passed} assertions passed.`)
} finally {
  try {
    sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop -m immediate > /dev/null 2>&1`)
  } catch {
    /* ignore */
  }
  sh(`rm -rf ${D} ${L}`)
}
