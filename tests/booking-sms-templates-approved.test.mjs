// Migrations 135 + 136 against a REAL Postgres — the last unproven link in the booking-SMS chain.
//
// Everything else about appointment SMS is provable offline, but one fact is not: whether the
// approved SMS template rows the send path requires actually exist in the database after the
// migration runs, and whether loadApprovedTemplate's EXACT query finds them. An SMS leg has no
// transactional fallback — `template_not_approved` means the message is simply never sent — so
// "the templates are approved" is the single assumption that would silently switch the whole
// feature off if it were wrong.
//
// This applies the migration chain (over a minimal fixture) and then asks the database the same
// questions the code asks:
//   • the six lifecycle SMS templates resolve through the approval + archived_at + version
//     ordering that loadApprovedTemplate uses;
//   • re-running the migration is a no-op (no duplicate rows to make the ORDER BY ambiguous);
//   • the consent evidence row the booking flow writes — appointment reference and all — is
//     actually insertable, with the FK behavior that keeps evidence alive past the appointment;
//   • migration 136's appointment frequency-cap row lands, and the outreach row is untouched.
// Requires local Postgres + `postgres` OS user; skips cleanly unless CI_REQUIRE_INFRA=1.
// Run: node tests/booking-sms-templates-approved.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// The authored registry is the source of truth the migration must agree with.
const tsOut = mkdtempSync(join(tmpdir(), 'fsos-bk-tplsql-'))
process.on('exit', () => {
  try {
    rmSync(tsOut, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})
execSync(
  `npx tsc src/lib/booking/sms-templates.ts src/lib/booking/notify-events.ts --outDir ${tsOut} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'ignore' },
)
const require = createRequire(import.meta.url)
const { BOOKING_SMS_TEMPLATES } = require(join(tsOut, 'sms-templates.js'))
const { LIFECYCLE_EVENTS, sourceKeyFor } = require(join(tsOut, 'notify-events.js'))

const D = '/tmp/fsos-booking-tpl'
const L = '/tmp/fsos-booking-tpllog'
const P = '55471'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d tpltest -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function scalar(sql) {
  const raw = sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d tpltest -t -A -c ${JSON.stringify(sql)}`)
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? ''
}
function exec(sql) {
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d tpltest -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(sql)}`)
}

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('Migrations 135 + 136 — approved SMS templates, consent evidence, caps (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres tpltest`)

  // Minimal fixture: only what migrations 135/136 touch, shaped as the real chain leaves it.
  writeFileSync(
    `${L}/fixture.sql`,
    `create extension if not exists pgcrypto;\n` +
      `create or replace function is_super() returns boolean language sql as 'select true';\n` +
      `create or replace function has_role(text) returns boolean language sql as 'select true';\n` +
      // comm_templates as migrations 009 + 012 + 061 + 105 leave it.
      `create table comm_templates (\n` +
      `  id uuid primary key default gen_random_uuid(),\n` +
      `  name text not null,\n` +
      `  channel text not null check (channel in ('sms','email')),\n` +
      `  category text,\n` +
      `  body text not null,\n` +
      `  approval_status text not null default 'draft' check (approval_status in ('draft','submitted','approved')),\n` +
      `  version integer not null default 1,\n` +
      `  submitted_at timestamptz, approved_at timestamptz, approved_by text, updated_by text, archived_at timestamptz,\n` +
      `  requires_optout boolean not null default true,\n` +
      `  body_text text, render_sha text, source_key text,\n` +
      `  introduces_sender boolean not null default false,\n` +
      `  created_at timestamptz not null default now(),\n` +
      `  updated_at timestamptz not null default now()\n` +
      `);\n` +
      `create table households (id uuid primary key default gen_random_uuid());\n` +
      `create table household_members (id uuid primary key default gen_random_uuid());\n` +
      `create table referrals (id uuid primary key default gen_random_uuid());\n` +
      `create table contacts (id uuid primary key default gen_random_uuid());\n` +
      `create table appointments (id uuid primary key default gen_random_uuid(), schedule_version int not null default 1);\n` +
      `create table comm_messages (id uuid primary key default gen_random_uuid());\n` +
      `create table booking_notification_deliveries (\n` +
      `  id uuid primary key default gen_random_uuid(),\n` +
      `  appointment_id uuid not null references appointments(id) on delete cascade,\n` +
      `  schedule_version int not null, event text not null, offset_minutes int not null default 0,\n` +
      `  channel text not null, status text not null default 'sent' check (status in ('sent','deferred','blocked','failed')),\n` +
      `  comm_message_id uuid references comm_messages(id) on delete set null,\n` +
      `  created_at timestamptz not null default now(),\n` +
      `  unique (appointment_id, schedule_version, event, offset_minutes, channel)\n` +
      `);\n` +
      // comm_contact_consents as migration 074 leaves it.
      // comm_frequency_policy as migration 054 leaves it (migration 136 adds a row to it).
      `create table comm_frequency_policy (\n` +
      `  id text primary key,\n` +
      `  enabled boolean not null default true,\n` +
      `  max_sms_per_day integer not null default 2,\n` +
      `  max_sms_per_7_days integer not null default 5,\n` +
      `  max_marketing_emails_per_day integer not null default 1,\n` +
      `  max_marketing_emails_per_7_days integer not null default 3,\n` +
      `  max_combined_touches_per_day integer not null default 3,\n` +
      `  min_interval_minutes integer not null default 60,\n` +
      `  is_assumption boolean not null default true,\n` +
      `  note text\n` +
      `);\n` +
      `insert into comm_frequency_policy (id, note) values ('global', 'outreach') on conflict (id) do nothing;\n` +
      `create table comm_contact_consents (\n` +
      `  id uuid primary key default gen_random_uuid(),\n` +
      `  contact text not null, channel text not null check (channel in ('sms','email','call')),\n` +
      `  action text not null default 'granted' check (action in ('granted','revoked')),\n` +
      `  consent_text text not null, consent_version text not null,\n` +
      `  source_url text, ip_address text, user_agent text,\n` +
      `  referral_id uuid references referrals(id) on delete set null,\n` +
      `  member_id uuid references household_members(id) on delete set null,\n` +
      `  captured_at timestamptz not null default now(), created_at timestamptz not null default now()\n` +
      `);\n`,
  )
  psqlFile(`${L}/fixture.sql`)
  psqlFile('supabase/migrations/135_booking_sms_appointment_notices.sql')
  psqlFile('supabase/migrations/136_comm_appointment_frequency_policy.sql')

  console.log('\napproved SMS templates')
  // loadApprovedTemplate (src/lib/booking/notify.ts) issues exactly this shape:
  //   select id, subject, body, body_text from comm_templates
  //    where source_key = $1 and approval_status = 'approved' and archived_at is null
  //    order by version desc limit 1
  const resolves = (sourceKey) =>
    scalar(
      `select count(*) from (select id from comm_templates where source_key = '${sourceKey}' ` +
        `and approval_status = 'approved' and archived_at is null order by version desc limit 1) q;`,
    )

  for (const event of LIFECYCLE_EVENTS) {
    const key = sourceKeyFor(event, 'sms')
    t(`[${event}] loadApprovedTemplate's exact query resolves ${key}`, () => {
      assert.equal(resolves(key), '1', `no APPROVED template for ${key} — this event could never send an SMS`)
    })
  }

  t('each row carries the authored body verbatim and its content hash', () => {
    for (const tpl of BOOKING_SMS_TEMPLATES) {
      const body = scalar(`select body from comm_templates where source_key = '${tpl.sourceKey}';`)
      // psql -A -t returns the body on one line; the authored bodies are single-line by design.
      assert.equal(body, tpl.body, `${tpl.sourceKey} body drifted from the authored registry`)
      assert.equal(scalar(`select channel from comm_templates where source_key = '${tpl.sourceKey}';`), 'sms')
      assert.equal(scalar(`select category from comm_templates where source_key = '${tpl.sourceKey}';`), 'appointment')
      assert.notEqual(scalar(`select render_sha from comm_templates where source_key = '${tpl.sourceKey}';`), '')
    }
  })

  t('re-running the migration inserts nothing (idempotent, no ambiguous duplicates)', () => {
    psqlFile('supabase/migrations/135_booking_sms_appointment_notices.sql')
    assert.equal(
      scalar("select count(*) from comm_templates where category = 'appointment' and channel = 'sms' and archived_at is null;"),
      '6',
    )
  })

  t('a database where templates:build:sms already ran ends with ONE live row per key', () => {
    // The realistic pre-state: the ops script created six DRAFT rows with random ids. A plain
    // insert would leave two live rows per source_key — sends would still be right, but the
    // build script's own `.maybeSingle()` lookup would start erroring on multiple rows, and the
    // approval console would show duplicates.
    exec(
      `insert into comm_templates (name, channel, category, body, render_sha, source_key, approval_status, version, updated_by) ` +
        `select name || ' (draft)', 'sms', 'appointment', 'OLD DRAFT BODY', 'oldsha', source_key, 'draft', 1, 'script:build-sms-templates' ` +
        `from comm_templates where source_key like 'appointment-%-sms' and archived_at is null;`,
    )
    assert.equal(scalar("select count(*) from comm_templates where source_key like 'appointment-%-sms' and archived_at is null;"), '12')

    psqlFile('supabase/migrations/135_booking_sms_appointment_notices.sql')

    assert.equal(
      scalar("select count(*) from comm_templates where source_key like 'appointment-%-sms' and archived_at is null;"),
      '6',
      'exactly one live row per source_key — the surplus is archived, not deleted',
    )
    assert.equal(
      scalar("select count(*) from comm_templates where source_key like 'appointment-%-sms' and archived_at is null and approval_status <> 'approved';"),
      '0',
      'every surviving row is approved',
    )
    assert.equal(
      scalar("select count(*) from comm_templates where source_key like 'appointment-%-sms' and archived_at is null and body = 'OLD DRAFT BODY';"),
      '0',
      'no stale draft body survives as the live row',
    )
    assert.ok(
      Number(scalar("select count(*) from comm_templates where source_key like 'appointment-%-sms' and archived_at is not null;")) >= 6,
      'the surplus rows are retained as history',
    )
    for (const event of LIFECYCLE_EVENTS) {
      assert.equal(resolves(sourceKeyFor(event, 'sms')), '1', `${event} still resolves to exactly one approved template`)
    }
  })

  t('an archived row is correctly invisible to the send path', () => {
    exec("update comm_templates set archived_at = now() where source_key = 'appointment-recap-sms';")
    assert.equal(resolves('appointment-recap-sms'), '0', 'archived_at must exclude the row')
    exec("update comm_templates set archived_at = null where source_key = 'appointment-recap-sms';")
    assert.equal(resolves('appointment-recap-sms'), '1')
  })

  t('a newer approved version wins the ORDER BY version DESC', () => {
    exec(
      `insert into comm_templates (name, channel, category, body, source_key, approval_status, version) ` +
        `values ('v2', 'sms', 'appointment', 'NEWER BODY', 'appointment-reminder-sms', 'approved', 2);`,
    )
    const body = scalar(
      `select body from comm_templates where source_key = 'appointment-reminder-sms' ` +
        `and approval_status = 'approved' and archived_at is null order by version desc limit 1;`,
    )
    assert.equal(body, 'NEWER BODY')
    exec("delete from comm_templates where source_key = 'appointment-reminder-sms' and version = 2;")
  })

  console.log('\nbooking consent evidence')
  t('the appointment + contact reference columns exist on the consent store', () => {
    assert.equal(
      scalar("select count(*) from information_schema.columns where table_name='comm_contact_consents' and column_name='appointment_id';"),
      '1',
    )
    assert.equal(
      scalar("select count(*) from information_schema.columns where table_name='comm_contact_consents' and column_name='contact_id';"),
      '1',
    )
  })

  t('the row the booking flow writes is insertable, appointment reference and all', () => {
    exec("insert into appointments (id) values ('aaaaaaaa-0000-4000-8000-000000000001');")
    exec("insert into contacts (id) values ('cccccccc-0000-4000-8000-000000000001');")
    exec(
      `insert into comm_contact_consents (contact, channel, action, consent_text, consent_version, source_url, ip_address, user_agent, contact_id, appointment_id, captured_at) ` +
        `values ('+15125551234','sms','granted','disclosure text','2026-07-A-info.deadbeef','https://x/schedule','203.0.113.7','UA','cccccccc-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001', now());`,
    )
    assert.equal(
      scalar("select count(*) from comm_contact_consents where appointment_id = 'aaaaaaaa-0000-4000-8000-000000000001';"),
      '1',
    )
  })

  t('deleting the appointment NULLs the reference but KEEPS the consent evidence', () => {
    // Evidence must outlive the appointment it was captured at — a TCPA record cannot be
    // cascade-deleted by ordinary appointment housekeeping.
    exec("delete from appointments where id = 'aaaaaaaa-0000-4000-8000-000000000001';")
    assert.equal(scalar("select count(*) from comm_contact_consents where contact = '+15125551234';"), '1')
    assert.equal(scalar("select count(*) from comm_contact_consents where contact = '+15125551234' and appointment_id is null;"), '1')
  })

  console.log('\nappointment frequency caps (migration 136)')
  t('the appointment cap row exists with a zero minimum interval', () => {
    // The email and SMS legs of one notice are sent together; under the outreach row's
    // 60-minute interval the second leg blocks itself on the first.
    assert.equal(scalar("select count(*) from comm_frequency_policy where id = 'appointment';"), '1')
    assert.equal(scalar("select min_interval_minutes from comm_frequency_policy where id = 'appointment';"), '0')
  })
  t('the per-day and per-7-day ceilings are still real bounds, not disabled', () => {
    assert.equal(scalar("select enabled from comm_frequency_policy where id = 'appointment';"), 't')
    assert.ok(Number(scalar("select max_sms_per_day from comm_frequency_policy where id = 'appointment';")) > 0)
    assert.ok(Number(scalar("select max_combined_touches_per_day from comm_frequency_policy where id = 'appointment';")) > 0)
  })
  t('the outreach row is untouched — campaign pacing is unchanged', () => {
    assert.equal(scalar("select min_interval_minutes from comm_frequency_policy where id = 'global';"), '60')
  })

  console.log('\ndelivery ledger block reason')
  t('the ledger can record WHY a leg was terminally withheld', () => {
    exec("insert into appointments (id) values ('aaaaaaaa-0000-4000-8000-000000000002');")
    exec(
      `insert into booking_notification_deliveries (appointment_id, schedule_version, event, offset_minutes, channel, status, block_reason) ` +
        `values ('aaaaaaaa-0000-4000-8000-000000000002', 1, 'confirmation', 0, 'sms', 'blocked', 'consent');`,
    )
    assert.equal(
      scalar("select block_reason from booking_notification_deliveries where appointment_id = 'aaaaaaaa-0000-4000-8000-000000000002';"),
      'consent',
    )
  })

  console.log(`\nAll ${passed} assertions passed.`)
} finally {
  try {
    sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -m immediate stop > /dev/null 2>&1`)
  } catch {
    /* best-effort */
  }
  try {
    sh(`rm -rf ${D} ${L}`)
  } catch {
    /* best-effort */
  }
}
