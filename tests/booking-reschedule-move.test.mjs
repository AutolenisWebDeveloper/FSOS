// Native booking — reschedule atomic-move proof (Slice 6). Stands up an ephemeral Postgres,
// applies a minimal fixture + migration 069, and proves the reschedule UPDATE:
//   • moving an appointment onto a slot another SCHEDULED appointment holds is rejected by the
//     (host_user_id, starts_at) WHERE status='scheduled' unique index (23505 → "just taken"),
//   • moving it to a FREE slot succeeds and FREES the old slot (a new booking can take it) —
//     claim-new-and-free-old in one statement.
// Requires local Postgres + `postgres` OS user; skips cleanly unless CI_REQUIRE_INFRA=1.
// Run: node tests/booking-reschedule-move.test.mjs
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

const D = '/tmp/fsos-booking-resch'
const L = '/tmp/fsos-booking-reschlog'
const P = '55461'
const HOST = '11111111-1111-1111-1111-111111111111'
const X = '2026-08-10T14:00:00Z'
const XE = '2026-08-10T14:30:00Z'
const Y = '2026-08-10T15:00:00Z'
const YE = '2026-08-10T15:30:00Z'
const Z = '2026-08-10T16:00:00Z'
const ZE = '2026-08-10T16:30:00Z'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function raises(sql) {
  try {
    sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(sql)}`)
    return false
  } catch {
    return true
  }
}
function scalar(sql) {
  return sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -t -A -c ${JSON.stringify(sql)}`)
    .split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? ''
}
const insert = (starts, ends) =>
  `insert into appointments (host_user_id, starts_at, ends_at, scheduled_at, status, booked_via) values ('${HOST}','${starts}','${ends}','${starts}','scheduled','native');`

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Reschedule atomic-move proof (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres rtest`)

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

  // A @ X and B @ Y, both scheduled for the same host.
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -q -c ${JSON.stringify(insert(X, XE))}`)
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -q -c ${JSON.stringify(insert(Y, YE))}`)

  const moveAtoY = `update appointments set starts_at='${Y}', ends_at='${YE}', scheduled_at='${Y}' where starts_at='${X}' and status='scheduled';`
  const moveAtoZ = `update appointments set starts_at='${Z}', ends_at='${ZE}', scheduled_at='${Z}' where starts_at='${X}' and status='scheduled';`

  t('moving A onto B’s occupied slot is rejected (unique index)', () => {
    assert.equal(raises(moveAtoY), true)
    assert.equal(scalar(`select count(*) from appointments where starts_at='${X}' and status='scheduled';`), '1') // A unchanged
  })
  t('moving A to a free slot succeeds and frees the old slot', () => {
    assert.equal(raises(moveAtoZ), false)
    assert.equal(scalar(`select count(*) from appointments where starts_at='${X}' and status='scheduled';`), '0') // old slot freed
    assert.equal(scalar(`select count(*) from appointments where starts_at='${Z}' and status='scheduled';`), '1')
    // A new booking can now take the freed slot X.
    assert.equal(raises(insert(X, XE)), false)
    assert.equal(scalar(`select count(*) from appointments where starts_at='${X}' and status='scheduled';`), '1')
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
