// tests/helpers/workshop-guarantee-common.mjs
// TEST HARNESS ONLY — shared bootstrap for the four Batch-0 GUARANTEE tests
// (workshop-guarantee-*.test.mjs). Stands up an ephemeral Postgres, applies the FULL
// migration chain into a template DB, and executes the REAL workshop comms engine
// (bundled with its production gate/dispatcher graph — see build-workshop-bundle.mjs)
// through the PostgREST-over-psql shim. Only the Resend/Twilio HTTP boundaries are
// intercepted at globalThis.fetch.
//
// These tests are the plan's EXPECTED-FAILURE MANIFEST entries (tests/
// expected-failures.json): pinned RED until the batch named in the manifest lands, and
// the runner FAILS if a pinned file passes early (stale pin / vacuous assertion guard).
import { execSync, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { makeShim } from './postgrest-shim.mjs'
import { buildWorkshopBundle } from './build-workshop-bundle.mjs'

// ─── environment guard (skip cleanly, fail loudly in CI) ────────────────────────
export function guardInfraOrExit() {
  let PGBIN = null
  try {
    const base = '/usr/lib/postgresql'
    if (existsSync(base)) {
      const ver = readdirSync(base).sort().pop()
      if (ver && existsSync(`${base}/${ver}/bin/initdb`)) PGBIN = `${base}/${ver}/bin`
    }
  } catch { /* ignore */ }
  let canRunAsPostgres = false
  try { execSync('id postgres', { stdio: 'pipe' }); canRunAsPostgres = true } catch { /* none */ }
  if (!PGBIN || !canRunAsPostgres) {
    if (process.env.CI_REQUIRE_INFRA === '1') {
      console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
      process.exit(1)
    }
    console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
    process.exit(0)
  }
  return PGBIN
}

const D = '/tmp/fsos-workshop-guarantee-data'
const L = '/tmp/fsos-workshop-guarantee-log'
const SQLDIR = '/tmp/fsos-workshop-guarantee-sql'
const P = '55490'
const BASE = 'fsos_wbase'

export const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
export function psql(dbName, args) {
  return execFileSync('runuser', ['-u', 'postgres', '--', 'psql', '-h', L, '-p', P, '-U', 'postgres',
    '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-t', '-A', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}
export const q = (dbName, sql) => psql(dbName, ['-c', sql]).trim()

// Supabase-managed stand-ins so the migration chain applies (same as comms-inbound-e2e).
const BOOTSTRAP = `
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
create or replace function auth.role() returns text language sql stable as 'select ''service_role''::text';
create or replace function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';
do 'begin
 if not exists (select from pg_roles where rolname=''authenticated'') then create role authenticated; end if;
 if not exists (select from pg_roles where rolname=''anon'') then create role anon; end if;
 if not exists (select from pg_roles where rolname=''service_role'') then create role service_role; end if;
end';
create schema if not exists cron;
create or replace function cron.schedule(text, text, text) returns bigint language sql as 'select 1::bigint';
create or replace function cron.unschedule(text) returns boolean language sql as 'select true';
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null,
  public boolean not null default false, created_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb,
  created_at timestamptz default now());
create or replace function storage.foldername(text) returns text[] language sql immutable
  as 'select string_to_array($1, ''/'')';
`

/** Stand up the cluster + template DB with the full migration chain applied. */
export function bootCluster(PGBIN) {
  sh(`rm -rf ${D} ${L} ${SQLDIR}`)
  mkdirSync(D, { recursive: true }); mkdirSync(L, { recursive: true }); mkdirSync(SQLDIR, { recursive: true })
  sh(`chown postgres:postgres ${D} ${L}`)
  sh(`chmod 755 ${SQLDIR}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres ${BASE}`)
  writeFileSync(`${SQLDIR}/bootstrap.sql`, BOOTSTRAP)
  sh(`chmod 644 ${SQLDIR}/bootstrap.sql`)
  psql(BASE, ['-q', '-f', `${SQLDIR}/bootstrap.sql`])

  const migDir = `${SQLDIR}/mig`
  mkdirSync(migDir, { recursive: true })
  const migFiles = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
  for (const f of migFiles) {
    const src = readFileSync(`supabase/migrations/${f}`, 'utf8')
    writeFileSync(`${migDir}/${f}`, src.replace(/^create extension if not exists "pg_cron";$/im,
      '-- [test harness] pg_cron unavailable in this container; cron.schedule is shimmed'))
  }
  sh(`chmod -R 755 ${migDir}`)
  for (const f of migFiles) psql(BASE, ['-q', '-f', `${migDir}/${f}`])
  console.log(`  applied ${migFiles.length} migrations into ${BASE}`)
}

export function stopCluster(PGBIN) {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop -m fast > /dev/null 2>&1`) } catch { /* best-effort */ }
}

// ─── deterministic clock ────────────────────────────────────────────────────────
const RealDate = Date
export function freezeClock(iso) {
  const fixed = new RealDate(iso).getTime()
  class FrozenDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(fixed); else super(...a) }
    static now() { return fixed }
  }
  globalThis.Date = FrozenDate
}
export function unfreezeClock() { globalThis.Date = RealDate }

// ─── provider-boundary interception (Resend + Twilio; anything else fails loud) ─
export const providerCalls = { resend: [], twilio: [] }
export function installFetchStub() {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url && url.url ? url.url : url)
    if (u.includes('api.resend.com')) {
      providerCalls.resend.push({ url: u, body: String(init.body ?? '') })
      return new Response(JSON.stringify({ id: `re_${providerCalls.resend.length}` }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.includes('api.twilio.com')) {
      providerCalls.twilio.push({ url: u, body: String(init.body ?? '') })
      return new Response(JSON.stringify({ sid: `SM${providerCalls.twilio.length}`.padEnd(34, '0') }),
        { status: 201, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`test harness: unexpected outbound fetch to ${u}`)
  }
}
export function resetProviderCalls() { providerCalls.resend.length = 0; providerCalls.twilio.length = 0 }

// ─── standard workshop fixture ──────────────────────────────────────────────────
export const IDS = {
  workshop: 'aaaa1111-1111-1111-1111-111111111111',
  session: 'aaaa2222-2222-2222-2222-222222222222',
  reg: 'aaaa3333-3333-3333-3333-333333333333',
  emailTpl: 'aaaa4444-4444-4444-4444-444444444444',
  smsTpl: 'aaaa5555-5555-5555-5555-555555555555',
  smsDisclosure: 'aaaa6666-6666-6666-6666-666666666666',
  approval: 'aaaa7777-7777-7777-7777-777777777777',
}

let dbSeq = 0
/**
 * Fresh DB cloned from the migrated template + one published workshop, one session, one
 * consented registration, and APPROVED reminder templates for the given kinds. Options:
 *   startsAtIso   — session start (drives which reminder kinds are due at the frozen now)
 *   timezone      — VENUE IANA timezone on the session
 *   phone         — registrant phone (its NPA drives the recipient-local zone after WS-005)
 *   registeredIso — registration timestamp (must precede the reminder fire-time)
 *   kinds         — reminder kinds to seed approved sendable templates for
 */
export function freshWorkshopDb(opts) {
  const name = `fsos_w${++dbSeq}`
  q('postgres', `drop database if exists ${name}`)
  q('postgres', `create database ${name} template ${BASE}`)
  const kinds = opts.kinds ?? ['reminder_1h']
  const tplRows = []
  for (const kind of kinds) {
    for (const channel of ['email', 'sms']) {
      const handle = channel === 'email' ? IDS.emailTpl : IDS.smsTpl
      // An SMS template is sendable only with an APPROVED (non-assumption) sms disclosure
      // attached (selectSendableTemplate) — mirror the production activation shape.
      tplRows.push(
        `insert into workshop_message_templates (kind, channel, subject, body, status, active, comm_template_id, disclosure_config_id, version)
           values ('${kind}', '${channel}',
                   ${channel === 'email' ? `'Reminder: {{workshop_title}}'` : 'null'},
                   'Markist Mathelus, Farmers Insurance — {{workshop_title}} starts {{starts_local}}. {{venue}}',
                   'approved', true, '${handle}', ${channel === 'sms' ? `'${IDS.smsDisclosure}'` : 'null'}, 2)
           on conflict (kind, channel, version) do nothing;`,
      )
    }
  }
  const seed = `
    insert into comm_templates (id, name, channel, body, approval_status)
      values ('${IDS.emailTpl}', 'Workshop reminder (email)', 'email', 'gate handle', 'approved'),
             ('${IDS.smsTpl}',  'Workshop reminder (sms)',  'sms',  'gate handle', 'approved');
    insert into workshop_disclosure_configs (id, kind, version, body, is_assumption, approved_by, approved_at)
      values ('${IDS.smsDisclosure}', 'sms', 9, 'Msg + data rates may apply. Reply STOP to opt out.', false, 'FFS Principal (test)', now())
      on conflict (kind, version) do nothing;
    -- Published THROUGH the real gate (mig 130 enforces it on INSERT too): draft first,
    -- then an approved compliance approval + the approved disclosure open the gate.
    insert into workshops (workshop_id, title, topic, scheduled_at, status, is_security, slug)
      values ('${IDS.workshop}', 'Retirement Readiness 101', 'retirement', '${opts.startsAtIso}', 'draft', false, 'retirement-readiness-101');
    insert into workshop_approvals (id, workshop_id, approver_name, approver_crd, decision)
      values ('${IDS.approval}', '${IDS.workshop}', 'FFS Principal (test)', 'CRD-000000', 'approved');
    update workshops
      set compliance_approval_ref = '${IDS.approval}', disclosure_config_id = '${IDS.smsDisclosure}', status = 'published'
      where workshop_id = '${IDS.workshop}';
    insert into workshop_sessions (id, workshop_id, starts_at, ends_at, delivery_mode, timezone, venue_name, status)
      values ('${IDS.session}', '${IDS.workshop}', '${opts.startsAtIso}',
              '${opts.endsAtIso ?? opts.startsAtIso}', 'in_person', '${opts.timezone}', 'McKinney Community Hall', 'scheduled');
    insert into workshop_registrations (reg_id, workshop_id, session_id, name, email, phone, consent_channels, status, registered_at)
      values ('${IDS.reg}', '${IDS.workshop}', '${IDS.session}', 'Alex Rivera', 'alex@example.com',
              ${opts.phone ? `'${opts.phone}'` : 'null'}, '{email,sms}', 'registered', '${opts.registeredIso}');
    insert into workshop_consent_events (registration_id, channel, action, disclosure_text, disclosure_version)
      values ('${IDS.reg}', 'email', 'granted', 'Educational event.', 'test v1'),
             ('${IDS.reg}', 'sms',   'granted', 'Educational event.', 'test v1');
    ${tplRows.join('\n')}
    ${opts.extraSql ?? ''}
  `
  writeFileSync(`${SQLDIR}/seed_${name}.sql`, seed)
  sh(`chmod 644 ${SQLDIR}/seed_${name}.sql`)
  psql(name, ['-q', '-f', `${SQLDIR}/seed_${name}.sql`])
  const shim = makeShim({ host: L, port: P, db: name })
  globalThis.__FSOS_DB__ = shim
  return { name, shim }
}

/** Provider env so the REAL send path runs (fetch is stubbed; nothing leaves the process). */
export function installProviderEnv() {
  process.env.RESEND_API_KEY = 're_test_harness'
  process.env.RESEND_FROM_EMAIL = 'workshops@notify.markistfsa.example'
  process.env.TWILIO_ACCOUNT_SID = 'ACtestharness'
  process.env.TWILIO_AUTH_TOKEN = 'test-token'
  process.env.TWILIO_PHONE_NUMBER = '+12145550100'
  process.env.SMS_A2P_APPROVED = 'true'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test'
}

/** Message-log rows for the fixture registration, ordered. */
export function logRows(dbName) {
  const raw = q(dbName,
    `select coalesce(jsonb_agg(t order by t->>'kind', t->>'channel'), '[]'::jsonb)::text
       from (select to_jsonb(l) as t from workshop_message_log l where registration_id = '${IDS.reg}') s`)
  return JSON.parse(raw || '[]')
}

/** WS-001 diagnostic: is the engine still selecting the nonexistent created_at column? */
export function ws001Signature(shim) {
  const bad = shim.queries.filter((s) => /workshop_registrations/.test(s) && /created_at/.test(s))
  return bad.length
    ? `WS-001 signature PRESENT: ${bad.length} engine query(ies) still select "created_at" from workshop_registrations (column does not exist; real column is registered_at)`
    : 'WS-001 signature absent (engine queries use the real column)'
}

export { buildWorkshopBundle }
