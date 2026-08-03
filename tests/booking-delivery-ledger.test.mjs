// Native booking — P5 delivery-ledger fire-once proof (mig 093, the correctness core).
// Stands up an ephemeral Postgres, applies migration 069 (appointments) + 093 (the delivery
// ledger, schedule_version, reminder config) behind minimal stubs, and proves the guarantees
// the ledger-backed reminder/lifecycle path (src/lib/booking/notify.ts) relies on:
//   • UNIQUE(appointment_id, schedule_version, event, offset_minutes, channel) makes a claim
//     (INSERT … ON CONFLICT DO NOTHING RETURNING id) fire once — a repeat claim returns 0 rows;
//   • distinct offsets / channels / events claim independently (multi-offset reminders);
//   • bumping schedule_version re-arms every leg exactly once (reschedule re-anchoring);
//   • releasing a claim (DELETE) lets a later tick re-claim (defer→retry).
// Requires local Postgres + `postgres` OS user; skips cleanly unless CI_REQUIRE_INFRA=1.
// Run: node tests/booking-delivery-ledger.test.mjs
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

const D = '/tmp/fsos-booking-led'
const L = '/tmp/fsos-booking-ledlog'
const P = '55461'
const HOST = '11111111-1111-1111-1111-111111111111'
const SLOT = '2026-08-10T14:00:00Z'
const END = '2026-08-10T14:30:00Z'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ledtest -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function scalar(sql) {
  const raw = sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ledtest -t -A -c ${JSON.stringify(sql)}`)
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? ''
}
function apptId() {
  return scalar('select id from appointments limit 1;')
}
// Emulates notify.ts claimDelivery: INSERT … ON CONFLICT DO NOTHING RETURNING id, wrapped in a
// COUNT so we can assert 1 (won the claim) vs 0 (already delivered) deterministically.
function claim(id, version, event, offset, channel) {
  return scalar(
    `with c as (insert into booking_notification_deliveries ` +
      `(appointment_id, schedule_version, event, offset_minutes, channel, status) ` +
      `values ('${id}', ${version}, '${event}', ${offset}, '${channel}', 'sent') ` +
      `on conflict (appointment_id, schedule_version, event, offset_minutes, channel) do nothing ` +
      `returning id) select count(*) from c;`,
  )
}

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('P5 delivery-ledger fire-once proof (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres ledtest`)

  // Minimal stubs so 069 + 093 apply in isolation: pgcrypto, the updated_at trigger, the spine
  // tables 069 references, a comm_messages stub (093's comm_message_id FK), and the RLS helper
  // functions 093's policies call (is_super / has_role) — bodies irrelevant to these DDL asserts.
  writeFileSync(
    `${L}/fixture.sql`,
    `create extension if not exists pgcrypto;\n` +
      `create or replace function update_updated_at() returns trigger language plpgsql as 'begin new.updated_at = now(); return new; end';\n` +
      `create or replace function is_super() returns boolean language sql as 'select true';\n` +
      `create or replace function has_role(text) returns boolean language sql as 'select true';\n` +
      `create table households (id uuid primary key default gen_random_uuid());\n` +
      `create table reviews (id uuid primary key default gen_random_uuid());\n` +
      `create table opportunities (id uuid primary key default gen_random_uuid());\n` +
      `create table contacts (id uuid primary key default gen_random_uuid(), full_name text not null default 'x');\n` +
      `create table comm_messages (id uuid primary key default gen_random_uuid());\n` +
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
  psqlFile('supabase/migrations/093_booking_notification_deliveries.sql')
  sh(
    `runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ledtest -q -c ` +
      JSON.stringify(
        `insert into appointments (host_user_id, starts_at, ends_at, scheduled_at, status, booked_via) values ('${HOST}','${SLOT}','${END}','${SLOT}','scheduled','native');`,
      ),
  )
  const id = apptId()

  t('schedule_version backfills existing appointments to 1 (no null gap)', () => {
    assert.equal(scalar('select count(*) from appointments where schedule_version = 1;'), '1')
    assert.equal(scalar('select count(*) from appointments where schedule_version is null;'), '0')
  })
  t('booking_reminder_config seeds the global row with sms_enabled OFF (the P5 flag)', () => {
    assert.equal(scalar("select sms_enabled from booking_reminder_config where id='global';"), 'f')
    assert.equal(scalar("select email_enabled from booking_reminder_config where id='global';"), 't')
    assert.equal(scalar("select is_assumption from booking_reminder_config where id='global';"), 't')
  })

  t('the first reminder claim (v1, 24h, email) wins (1 row)', () => {
    assert.equal(claim(id, 1, 'reminder', 1440, 'email'), '1')
  })
  t('a repeat of the same leg claims nothing (0 rows) — fire-once', () => {
    assert.equal(claim(id, 1, 'reminder', 1440, 'email'), '0')
  })
  t('a different offset (1h) at the same version claims independently (1 row)', () => {
    assert.equal(claim(id, 1, 'reminder', 60, 'email'), '1')
  })
  t('the sms channel for the same offset is a distinct leg (1 row) — email/sms independent', () => {
    assert.equal(claim(id, 1, 'reminder', 1440, 'sms'), '1')
  })
  t('an immediate event (confirmation, offset 0) is a distinct leg (1 row)', () => {
    assert.equal(claim(id, 1, 'confirmation', 0, 'email'), '1')
  })
  t('bumping schedule_version re-arms the 24h reminder exactly once (reschedule re-anchor)', () => {
    // Simulate the reschedule mover's schedule_version bump.
    sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ledtest -q -c ${JSON.stringify('update appointments set schedule_version = 2;')}`)
    assert.equal(claim(id, 2, 'reminder', 1440, 'email'), '1') // new version → fires again
    assert.equal(claim(id, 2, 'reminder', 1440, 'email'), '0') // but still once per version
  })
  t('releasing a claim (DELETE) lets a later tick re-claim (defer→retry path)', () => {
    sh(
      `runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ledtest -q -c ` +
        JSON.stringify(`delete from booking_notification_deliveries where schedule_version=2 and event='reminder' and offset_minutes=1440 and channel='email';`),
    )
    assert.equal(claim(id, 2, 'reminder', 1440, 'email'), '1')
  })
  t('the event CHECK admits all six lifecycle events and rejects an unknown one', () => {
    for (const ev of ['confirmation', 'reminder', 'rescheduled', 'cancellation', 'no_show_followup', 'recap']) {
      // version 9 keeps these clear of the claims above; each distinct event → 1 row.
      assert.equal(claim(id, 9, ev, 0, 'email'), '1')
    }
    let rejected = false
    try {
      sh(
        `runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ledtest -v ON_ERROR_STOP=1 -q -c ` +
          JSON.stringify(`insert into booking_notification_deliveries (appointment_id, schedule_version, event, offset_minutes, channel) values ('${id}', 9, 'bogus_event', 0, 'email');`),
      )
    } catch {
      rejected = true
    }
    assert.equal(rejected, true, 'an out-of-enum event must violate the CHECK constraint')
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
