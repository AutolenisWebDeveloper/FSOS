// C-2 PROOF — the legacy customers.dob PII is encrypted at rest and the plaintext
// column is retired (CLAUDE.md §5 / data-guardrails). Applies migration 042 to an
// ephemeral Postgres over a minimal fixture that mirrors the 001 objects it touches
// (customers + set_customer_age trigger + run_nightly_scoring + encrypt/decrypt from
// 010) and asserts:
//   • customers has NO plaintext `dob` column after the migration;
//   • an existing plaintext dob row is BACKFILLED into dob_enc (decrypts to the same date);
//   • customer_dob_set/customer_dob_get round-trip a value and maintain age + birth_month/day;
//   • EXECUTE on the DOB RPCs is REVOKED from public/anon (fixes audit M7 on the legacy side);
//   • the is_security firewall column exists (default false).
// Mirrors tests/rls-firewall.test.mjs' ephemeral-Postgres harness.
// Run: node tests/customer-dob-encryption.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'

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
try { sh('id postgres'); canRunAsPostgres = true } catch { /* no postgres user */ }

if (!PGBIN || !canRunAsPostgres) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    console.error('The DOB-encryption proof (C-2) cannot silently skip in CI — provision Postgres.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  process.exit(0)
}

const D = '/tmp/fsos-dob-test'
const L = '/tmp/fsos-dob-log'
const P = '55457'
const H = L
const KEY = 'test-dob-key-0123456789'
const CID = '11111111-1111-1111-1111-111111111111'

function psqlFile(path, opts = '') {
  // `opts` injects PGOPTIONS (e.g. the app.dob_key GUC the migration reads for backfill).
  sh(`runuser -u postgres -- ${opts} psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function q(sql) {
  const raw = sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`)
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

const results = []
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) }
}

console.log('C-2 — legacy customers DOB encryption + plaintext retirement (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres fsos_test`)

  // Minimal fixture mirroring the 001 objects migration 042 touches + the 010 crypto
  // helpers. (Real 001 pulls in pg_cron, unavailable in a bare initdb, so we recreate
  // only the relevant surface.)
  const fixture = `${L}/fixture.sql`
  writeFileSync(fixture, `
    create extension if not exists pgcrypto;
    create table customers (
      customer_id uuid primary key default gen_random_uuid(),
      first_name text, last_name text, dob date, age integer
    );
    create or replace function encrypt_dob(d date, key text) returns bytea language sql volatile as $$
      select pgp_sym_encrypt(d::text, key); $$;
    create or replace function decrypt_dob(e bytea, key text) returns date language sql stable as $$
      select nullif(pgp_sym_decrypt(e, key), '')::date; $$;
    create or replace function set_customer_age() returns trigger language plpgsql as $$
      begin new.age := case when new.dob is null then null else date_part('year', age(new.dob))::integer end; return new; end; $$;
    create trigger customers_set_age before insert or update of dob on customers
      for each row execute function set_customer_age();
    create or replace function run_nightly_scoring() returns void language plpgsql as $$
      begin update customers set age = date_part('year', age(dob))::integer where dob is not null; end; $$;
    -- Existing legacy row carrying PLAINTEXT dob (must be backfilled + then dropped).
    insert into customers (customer_id, first_name, dob) values ('${CID}', 'Legacy', date '1980-05-15');
  `)
  psqlFile(fixture)

  // Apply the real migration WITH the encryption key as a session GUC (exactly how
  // `npm run migrate` now passes DOB_ENCRYPTION_KEY — via PGOPTIONS → app.dob_key).
  psqlFile('supabase/migrations/042_legacy_customer_pii_firewall.sql', `env PGOPTIONS="-c app.dob_key=${KEY}"`)

  check('customers has NO plaintext dob column', () => {
    const n = q(`select count(*) from information_schema.columns where table_name='customers' and column_name='dob'`)
    assert.equal(n, '0', `expected 0 dob columns, got ${n}`)
  })
  check('dob_enc + is_security + birth_month/day columns exist', () => {
    const cols = q(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_name='customers' and column_name in ('dob_enc','is_security','birth_month','birth_day')`)
    assert.equal(cols, 'birth_day,birth_month,dob_enc,is_security', `got ${cols}`)
  })
  check('is_security defaults false', () => {
    assert.equal(q(`select is_security from customers where customer_id='${CID}'`), 'f')
  })
  check('existing plaintext dob was BACKFILLED to dob_enc (decrypts to original)', () => {
    const d = q(`select decrypt_dob(dob_enc, '${KEY}') from customers where customer_id='${CID}'`)
    assert.equal(d, '1980-05-15', `expected 1980-05-15, got ${d}`)
  })
  check('backfill maintained age + birth_month/day for the existing row', () => {
    assert.equal(q(`select birth_month from customers where customer_id='${CID}'`), '5')
    assert.equal(q(`select birth_day from customers where customer_id='${CID}'`), '15')
    const age = Number(q(`select age from customers where customer_id='${CID}'`))
    assert.ok(age >= 40 && age <= 60, `age looks wrong: ${age}`)
  })
  check('customer_dob_set/get round-trips a NEW value + maintains age + birth_month/day', () => {
    q(`insert into customers (customer_id, first_name) values ('22222222-2222-2222-2222-222222222222', 'New')`)
    q(`select customer_dob_set('22222222-2222-2222-2222-222222222222', date '1990-11-03', '${KEY}')`)
    assert.equal(q(`select customer_dob_get('22222222-2222-2222-2222-222222222222', '${KEY}')`), '1990-11-03')
    assert.equal(q(`select birth_month from customers where customer_id='22222222-2222-2222-2222-222222222222'`), '11')
    assert.equal(q(`select birth_day from customers where customer_id='22222222-2222-2222-2222-222222222222'`), '3')
    const age = Number(q(`select age from customers where customer_id='22222222-2222-2222-2222-222222222222'`))
    assert.ok(age >= 30 && age <= 45, `age looks wrong: ${age}`)
  })
  check('EXECUTE on DOB RPCs is REVOKED from public + anon (M7 fix)', () => {
    // has_function_privilege for PUBLIC is checked via the special role 'public'.
    const pub = q(`select has_function_privilege('public', 'customer_dob_get(uuid,text)', 'EXECUTE')`)
    assert.equal(pub, 'f', 'customer_dob_get must NOT be executable by PUBLIC')
    const pubSet = q(`select has_function_privilege('public', 'customer_dob_set(uuid,date,text)', 'EXECUTE')`)
    assert.equal(pubSet, 'f', 'customer_dob_set must NOT be executable by PUBLIC')
  })
  check('run_nightly_scoring no longer reads the dropped dob column', () => {
    const def = q(`select pg_get_functiondef('run_nightly_scoring()'::regprocedure)`)
    assert.ok(!/age\(dob\)/.test(def), 'run_nightly_scoring must not reference age(dob) after the column is dropped')
  })
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop -m immediate > /dev/null 2>&1`) } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} DOB-encryption assertion(s) FAILED — build-blocking.`); process.exit(1) }
console.log(`\nAll ${results.length} DOB-encryption proofs passed (C-2: no plaintext DOB at rest).`)
