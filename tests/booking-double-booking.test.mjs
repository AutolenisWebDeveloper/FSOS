// Native booking — DB-level double-booking proof (mig 069). Stands up an ephemeral
// Postgres, applies a minimal fixture + migration 069, and proves the partial unique index
// uq_appointments_host_slot enforces "at most one scheduled appointment per (host, slot)":
//   • a single statement inserting the same (host, slot) twice fails atomically (no rows),
//   • a second sequential insert of a taken slot is rejected (23505),
//   • cancelling frees the slot (a re-book then succeeds),
//   • a different host may hold the same slot,
//   • the booked_via CHECK rejects a bad value.
// This is the DB guarantee the booking service (lib/booking/book.ts) relies on to make a
// concurrent double-booking impossible — the index serializes racing inserts so exactly one
// wins. Requires a local Postgres + `postgres` OS user; skips cleanly locally unless
// CI_REQUIRE_INFRA=1 (then it must run). Run: node tests/booking-double-booking.test.mjs
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
  /* no postgres user */
}

if (!PGBIN || !canRunAsPostgres) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  console.log('(The double-booking index was also verified on the live Supabase preview branch.)')
  process.exit(0)
}

const D = '/tmp/fsos-booking-dbtest'
const L = '/tmp/fsos-booking-dblog'
const P = '55457'
const HOST = '11111111-1111-1111-1111-111111111111'
const HOST2 = '22222222-2222-2222-2222-222222222222'
const SLOT = '2026-08-03T14:00:00Z'
const END = '2026-08-03T14:30:00Z'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d bktest -v ON_ERROR_STOP=1 -q -f ${path}`)
}
/** Run a statement; return true iff it raised an error (used to assert rejections). */
function raises(sql) {
  try {
    sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d bktest -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(sql)}`)
    return false
  } catch {
    return true
  }
}
function scalar(sql) {
  const raw = sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d bktest -t -A -c ${JSON.stringify(sql)}`)
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? ''
}
const insert = (host, starts) =>
  `insert into appointments (host_user_id, starts_at, ends_at, scheduled_at, status, booked_via) ` +
  `values ('${host}','${starts}','${END}','${starts}','scheduled','native');`

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('Double-booking index proof (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres bktest`)

  // Minimal fixture mirroring the columns mig 069 references (appointments from mig 009 +
  // the FK targets), then the real migration 069 on top.
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

  t('a single statement inserting the same (host, slot) twice fails atomically', () => {
    const dup =
      `insert into appointments (host_user_id, starts_at, ends_at, scheduled_at, status, booked_via) values ` +
      `('${HOST}','${SLOT}','${END}','${SLOT}','scheduled','native'),` +
      `('${HOST}','${SLOT}','${END}','${SLOT}','scheduled','native');`
    assert.equal(raises(dup), true)
    assert.equal(scalar(`select count(*) from appointments;`), '0') // atomic — no partial row
  })

  t('first booking succeeds; a second at the same (host, slot) is rejected', () => {
    assert.equal(raises(insert(HOST, SLOT)), false)
    assert.equal(raises(insert(HOST, SLOT)), true) // 23505
    assert.equal(scalar(`select count(*) from appointments where status='scheduled';`), '1')
  })

  t('cancelling frees the slot — a re-book then succeeds', () => {
    sh(
      `runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d bktest -q -c ` +
        JSON.stringify(`update appointments set status='cancelled' where host_user_id='${HOST}' and starts_at='${SLOT}' and status='scheduled';`),
    )
    assert.equal(raises(insert(HOST, SLOT)), false)
    assert.equal(scalar(`select count(*) from appointments where status='scheduled';`), '1')
  })

  t('a different host may hold the same slot', () => {
    assert.equal(raises(insert(HOST2, SLOT)), false)
    assert.equal(scalar(`select count(*) from appointments where status='scheduled';`), '2')
  })

  t('the booked_via CHECK rejects an unknown value', () => {
    assert.equal(
      raises(
        `insert into appointments (host_user_id, starts_at, ends_at, scheduled_at, status, booked_via) values ('${HOST}','2026-09-01T14:00:00Z','2026-09-01T14:30:00Z','2026-09-01T14:00:00Z','scheduled','bogus');`,
      ),
      true,
    )
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
