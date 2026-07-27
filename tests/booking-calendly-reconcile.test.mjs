// Native booking — Calendly decommission reconciliation proof (Slice 8, mig 073). Stands up
// an ephemeral Postgres with the legacy activity/customers/households + spine appointments +
// audit_log, seeds representative Calendly activity rows, applies migration 073, and proves:
//   • only OPEN (future, non-cancelled, parseable) Calendly bookings are lifted onto the spine
//     as booked_via='legacy_calendly' appointments,
//   • they are linked to the spine household via legacy_customer_id (null when unbridged — never dropped),
//   • past, cancelled, and unparseable-note rows are skipped (§4.3 — no invented data),
//   • the reconciliation is IDEMPOTENT (a second apply inserts nothing), and
//   • a durable count is written to the append-only audit_log.
// Requires local Postgres + `postgres` OS user; skips cleanly unless CI_REQUIRE_INFRA=1.
// Run: node tests/booking-calendly-reconcile.test.mjs
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

const D = '/tmp/fsos-calendly-recon'
const L = '/tmp/fsos-calendly-reconlog'
const P = '55481'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function scalar(sql) {
  return sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -q -t -A -c ${JSON.stringify(sql)}`)
    .split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? ''
}

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Calendly reconciliation proof (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres rtest`)

  // Minimal legacy + spine fixture with exactly the columns migration 073 reads/writes.
  writeFileSync(
    `${L}/fixture.sql`,
    `create extension if not exists pgcrypto;
     create table customers (customer_id uuid primary key default gen_random_uuid());
     create table households (id uuid primary key default gen_random_uuid(), legacy_customer_id uuid);
     create table activity (
       activity_id uuid primary key default gen_random_uuid(),
       customer_id uuid, type text, channel text, subject text, notes text,
       created_at timestamptz not null default now()
     );
     create table appointments (
       id uuid primary key default gen_random_uuid(),
       household_id uuid, scheduled_at timestamptz, starts_at timestamptz,
       status text not null default 'scheduled', booked_via text, external_ref text,
       booker_timezone text, created_at timestamptz not null default now(),
       updated_at timestamptz not null default now()
     );
     create table audit_log (
       id uuid primary key default gen_random_uuid(), actor text, action text, entity text,
       entity_id uuid, diff jsonb, created_at timestamptz not null default now()
     );

     -- Customers: C1,C2,C4 bridged to households; C3 unbridged.
     insert into customers (customer_id) values
       ('11111111-1111-1111-1111-111111111111'),
       ('22222222-2222-2222-2222-222222222222'),
       ('33333333-3333-3333-3333-333333333333'),
       ('44444444-4444-4444-4444-444444444444');
     insert into households (id, legacy_customer_id) values
       ('aaaaaaaa-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111'),
       ('bbbbbbbb-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222'),
       ('dddddddd-4444-4444-4444-444444444444','44444444-4444-4444-4444-444444444444');

     -- A1: C1 open future valid → MIGRATE (household aaaa...).
     insert into activity (activity_id, customer_id, type, channel, subject, notes) values
       ('a0000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','appointment','calendly',
        'Appointment booked — Financial Review',
        'Via Calendly · ' || to_char(now() + interval '10 days','YYYY-MM-DD"T"HH24:MI:SS"Z"') || ' · America/Chicago');

     -- A2: C2 future valid, but a later cancellation note → EXCLUDE.
     insert into activity (activity_id, customer_id, type, channel, subject, notes, created_at) values
       ('a0000002-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','appointment','calendly',
        'Appointment booked — Review',
        'Via Calendly · ' || to_char(now() + interval '12 days','YYYY-MM-DD"T"HH24:MI:SS"Z"') || ' · America/Chicago',
        now() - interval '2 days');
     insert into activity (customer_id, type, channel, subject, notes, created_at) values
       ('22222222-2222-2222-2222-222222222222','note','calendly','Appointment canceled — Review',
        'Canceled via Calendly', now() - interval '1 day');

     -- A3: C4 PAST valid → EXCLUDE (already happened).
     insert into activity (customer_id, type, channel, subject, notes) values
       ('44444444-4444-4444-4444-444444444444','appointment','calendly','Appointment booked — Past',
        'Via Calendly · ' || to_char(now() - interval '5 days','YYYY-MM-DD"T"HH24:MI:SS"Z"') || ' · America/Chicago');

     -- A4: C1 future but UNPARSEABLE start segment → EXCLUDE (§4.3).
     insert into activity (customer_id, type, channel, subject, notes) values
       ('11111111-1111-1111-1111-111111111111','appointment','calendly','Appointment booked — No time',
        'Via Calendly ·  · America/Chicago');

     -- A5: C3 open future valid but UNBRIDGED customer → MIGRATE with null household (never dropped).
     insert into activity (activity_id, customer_id, type, channel, subject, notes) values
       ('a0000005-0000-0000-0000-000000000005','33333333-3333-3333-3333-333333333333','appointment','calendly',
        'Appointment booked — Unbridged',
        'Via Calendly · ' || to_char(now() + interval '8 days','YYYY-MM-DD"T"HH24:MI:SS"Z"') || ' · America/New_York');
    `,
  )
  psqlFile(`${L}/fixture.sql`)
  psqlFile('supabase/migrations/073_calendly_decommission_reconcile.sql')

  t('exactly the two OPEN bookings are lifted onto the spine', () => {
    assert.equal(scalar(`select count(*) from appointments where booked_via='legacy_calendly';`), '2')
  })
  t('the bridged booking (A1) links to its spine household', () => {
    assert.equal(
      scalar(`select household_id from appointments where external_ref='calendly:a0000001-0000-0000-0000-000000000001';`),
      'aaaaaaaa-1111-1111-1111-111111111111',
    )
  })
  t('the unbridged booking (A5) migrates with a null household (never dropped)', () => {
    assert.equal(
      scalar(`select coalesce(household_id::text,'NULL') from appointments where external_ref='calendly:a0000005-0000-0000-0000-000000000005';`),
      'NULL',
    )
    assert.equal(scalar(`select booker_timezone from appointments where external_ref='calendly:a0000005-0000-0000-0000-000000000005';`), 'America/New_York')
  })
  t('scheduled_at is kept in lock-step with starts_at (mig 069 invariant)', () => {
    assert.equal(scalar(`select count(*) from appointments where booked_via='legacy_calendly' and scheduled_at is distinct from starts_at;`), '0')
  })
  t('past / cancelled / unparseable bookings are NOT migrated', () => {
    // Only A1 + A5 external_refs exist; no others.
    assert.equal(scalar(`select count(*) from appointments where external_ref like 'calendly:%';`), '2')
  })
  t('a durable reconciliation count is written to audit_log', () => {
    assert.equal(scalar(`select (diff->>'migrated') from audit_log where action='import.committed' and diff->>'source'='calendly' order by created_at desc limit 1;`), '2')
  })
  t('re-applying the migration is idempotent (no duplicates)', () => {
    psqlFile('supabase/migrations/073_calendly_decommission_reconcile.sql')
    assert.equal(scalar(`select count(*) from appointments where booked_via='legacy_calendly';`), '2')
    // A second audit row is written (the run happened) but its count is 0.
    assert.equal(scalar(`select (diff->>'migrated') from audit_log where action='import.committed' and diff->>'source'='calendly' order by created_at desc limit 1;`), '0')
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
