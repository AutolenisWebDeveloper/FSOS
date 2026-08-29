// MIGRATION CHAIN PROOF — the whole supabase/migrations/ chain applies to an empty
// database, in the runner's own order, using the REAL scripts/migrate.mjs.
//
// WHY THIS EXISTS. On 2026-08-29 migrations 123 and 124 merged and deployed to
// production while the database still lacked their columns. Nothing caught it: CI ran
// type-check/lint/test/build but never touched a migration, and the ledger
// `schema_migrations` did not exist in production at all, so neither the repo nor the
// database could answer "is the schema current?". This proof closes the half of that gap
// that lives in the repo — a migration that cannot apply, or that breaks the chain's
// ordering, now fails the PR instead of the deploy. The OTHER half (is a given database
// actually up to date?) is scripts/check-migration-drift.mjs, which needs a live
// DATABASE_URL and runs as its own CI step.
//
// WHAT IT ASSERTS
//   1. Every migration applies to an empty database, in migrate.mjs's lexical order,
//      with no error. This is the real gate: broken SQL, a forward reference, or a file
//      that depends on an unapplied predecessor fails here.
//   2. The runner records all of them in `schema_migrations`, and a SECOND run applies
//      ZERO files. That is the ledger mechanism whose absence in production allowed the
//      drift to go unnoticed and would have made a recovery run re-execute all 129 files
//      (backfills included).
//   3. The resulting schema carries objects the deployed code requires — including the
//      123/124 timezone-resolution columns whose absence silently no-opped every send's
//      outcome patch (send.ts writes them unconditionally; PostgREST returns 42703 in an
//      unchecked `error`, so the failure is invisible).
//
// It does NOT assert that re-applying the SQL itself is idempotent: it deliberately is
// not. 054 is hotfixed by 055 (and 042 by 044), so a blind re-run is destructive — which
// is exactly why the ledger, not re-runnability, is the safety mechanism.
//
// PLATFORM SHIMS. Two Supabase-managed extensions are absent from a stock Postgres:
//   • pg_cron — 001 creates it unguarded and calls cron.schedule(). Stubbed below with a
//     no-op extension so the DDL is exercised; this proves the SQL is valid, NOT that the
//     nightly job schedules. That behavior is Supabase's, not this repo's, to verify.
//   • vector  — needs no stub: 036 already wraps it in an exception block and guards the
//     embedding column/index behind `pg_type where typname='vector'`, so it self-skips.
//
// Requires a local Postgres + the `postgres` OS user (as the other infra proofs do), and
// write access to the Postgres extension dir for the pg_cron stub (CI runs this step under
// sudo). Registered in the `rls` set in scripts/run-tests.mjs, so it runs under
// `npm run test:rls`, NOT in the unit suite.
// Run: node tests/migration-chain.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
}

// Locate a Postgres bin dir. Skip cleanly (never a false pass) if unavailable.
let PGBIN = null
let PGVER = null
try {
  const base = '/usr/lib/postgresql'
  if (existsSync(base)) {
    const ver = readdirSync(base).sort().pop()
    if (ver && existsSync(`${base}/${ver}/bin/initdb`)) { PGBIN = `${base}/${ver}/bin`; PGVER = ver }
  }
} catch { /* ignore */ }

let canRunAsPostgres = false
try { sh('id postgres'); canRunAsPostgres = true } catch { /* no postgres user */ }

if (!PGBIN || !canRunAsPostgres) {
  // In CI this proof MUST run — a missing toolchain is a failure, not a pass.
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    console.error('The migration-chain proof cannot silently skip in CI — provision Postgres.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  process.exit(0)
}

const D = '/tmp/fsos-migchain-data'
const L = '/tmp/fsos-migchain-log'
const P = '55456'
const DB = 'fsos_migchain'
const URL = `postgresql://postgres@/${DB}?host=${L}&port=${P}`

function q(sql) {
  const raw = sh(
    `runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ${DB} -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`,
  )
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

const migrationFiles = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()

let failures = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓', name) } catch (e) { failures++; console.log('  ✗', name + ':', e.message) }
}

// Stub pg_cron (see PLATFORM SHIMS above) so 001's unguarded CREATE EXTENSION and its
// cron.schedule() call execute. The stub is a no-op that records nothing.
function stubPgCron() {
  const extDir = `/usr/share/postgresql/${PGVER}/extension`
  if (existsSync(`${extDir}/pg_cron.control`)) return 'already available'
  writeFileSync(
    `${extDir}/pg_cron.control`,
    "comment = 'no-op pg_cron stub for the FSOS migration-chain proof'\ndefault_version = '1.0'\nrelocatable = false\nschema = cron\n",
  )
  writeFileSync(
    `${extDir}/pg_cron--1.0.sql`,
    `create function schedule(job_name text, schedule text, command text) returns bigint language sql as 'select 1::bigint';\n` +
      `create function schedule(schedule text, command text) returns bigint language sql as 'select 1::bigint';\n` +
      `create function unschedule(job_id bigint) returns boolean language sql as 'select true';\n` +
      `create function unschedule(job_name text) returns boolean language sql as 'select true';\n`,
  )
  return 'stubbed (no-op)'
}

console.log(`Migration chain — ${migrationFiles.length} files onto an empty database`)
try {
  try {
    console.log(`  pg_cron: ${stubPgCron()}`)
  } catch (e) {
    const msg = `cannot stub pg_cron (${e.message}) — the extension dir is not writable; run this proof as root/sudo.`
    if (process.env.CI_REQUIRE_INFRA === '1') { console.error('FAIL: ' + msg); process.exit(1) }
    console.log('SKIP: ' + msg)
    process.exit(0)
  }
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres ${DB}`)

  // Supabase-provided surface the migrations assume exists. This is PLATFORM, not schema,
  // and it is fully enumerable — the whole set is: auth.uid/role/jwt, storage.buckets, and
  // the three PostgREST roles RLS policies grant to. (Verified by grepping the migrations
  // for `auth.` and `storage.` references; if a migration ever reaches for a new platform
  // object, this proof fails loudly here rather than silently skipping it.)
  writeFileSync(
    `${L}/setup.sql`,
    `create schema if not exists auth;\n` +
      `create schema if not exists storage;\n` +
      `create extension if not exists pgcrypto;\n` +
      `create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';\n` +
      `create or replace function auth.role() returns text language sql stable as 'select current_user::text';\n` +
      `create or replace function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';\n` +
      `create table if not exists storage.buckets (id text primary key, name text, public boolean default false);\n` +
      `do 'begin if not exists (select from pg_roles where rolname=''authenticated'') then create role authenticated; end if; ` +
      `if not exists (select from pg_roles where rolname=''anon'') then create role anon; end if; ` +
      `if not exists (select from pg_roles where rolname=''service_role'') then create role service_role; end if; end';\n`,
  )
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ${DB} -v ON_ERROR_STOP=1 -q -f ${L}/setup.sql`)

  // ── 1. The real runner, first pass ────────────────────────────────────────
  let out1 = ''
  check(`all ${migrationFiles.length} migrations apply to an empty database`, () => {
    out1 = sh(`node scripts/migrate.mjs`, { env: { ...process.env, DATABASE_URL: URL }, maxBuffer: 64 * 1024 * 1024 })
    const applied = (out1.match(/→ applying:/g) || []).length
    assert.equal(applied, migrationFiles.length, `applied ${applied}, expected ${migrationFiles.length}`)
  })

  check('the runner records every applied file in schema_migrations', () => {
    assert.equal(Number(q('select count(*) from schema_migrations')), migrationFiles.length)
  })

  // ── 2. Second pass is a no-op — the ledger mechanism itself ───────────────
  check('a SECOND run applies ZERO files (the ledger production was missing)', () => {
    const out2 = sh(`node scripts/migrate.mjs`, { env: { ...process.env, DATABASE_URL: URL }, maxBuffer: 64 * 1024 * 1024 })
    const reapplied = (out2.match(/→ applying:/g) || []).length
    assert.equal(reapplied, 0, `re-applied ${reapplied} file(s) — the ledger is not being honored`)
    assert.match(out2, /Done\. 0 migration\(s\) applied\./)
  })

  // ── 3. The chain produces the schema the deployed code requires ───────────
  // Each entry is read or written by a hot path; a chain that no longer produces one of
  // them would ship the same silent-42703 class of failure that motivated this file.
  const requiredColumns = [
    // mig 123/124 — written unconditionally by send.ts on EVERY dispatch.
    ['comm_messages', 'resolved_timezone'],
    ['comm_messages', 'tz_resolution_method'],
    ['comm_messages', 'tz_resolution_input'],
    // mig 054 — purpose recorded on the send record (frequency counting).
    ['comm_messages', 'purpose'],
    // mig 055 — channel-wide consent must keep its onConflict target shape.
    ['consents', 'channel'],
  ]
  for (const [t, c] of requiredColumns) {
    check(`${t}.${c} exists after the chain`, () => {
      assert.equal(
        q(`select count(*) from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}'`),
        '1',
      )
    })
  }

  check("tz_resolution_method CHECK admits 'both' (mig 124 supersedes 123's narrower CHECK)", () => {
    const def = q(`select pg_get_constraintdef(oid) from pg_constraint where conname='comm_messages_tz_resolution_method_check'`)
    assert.match(def, /both/, `constraint def was: ${def}`)
  })

  check('consents keeps a FULL unique(member_id,channel) — onConflict target for STOP handling', () => {
    // 054 replaced this with partial indexes and 055 restored it. Seven call sites,
    // including the STOP/START opt-out handler, upsert with onConflict member_id,channel;
    // PostgREST cannot infer a partial index, so losing this breaks TCPA opt-out.
    const n = q(`select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid where t.relname='consents' and c.contype='u' and pg_get_constraintdef(c.oid) ilike '%(member_id, channel)%'`)
    assert.equal(n, '1', 'the channel-wide unique constraint is gone — consent upserts would fail')
  })

  check('comm_consent_purposes carries the purpose axis (mig 055 companion table)', () => {
    assert.equal(q(`select count(*) from information_schema.tables where table_schema='public' and table_name='comm_consent_purposes'`), '1')
  })
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop > /dev/null 2>&1`) } catch { /* ignore */ }
}

if (failures) {
  console.error(`\n✗ ${failures} migration-chain assertion(s) FAILED — build-blocking.`)
  process.exit(1)
}
console.log(`\nMigration chain proof passed (${migrationFiles.length} migrations apply cleanly; ledger honored; required schema present).`)
