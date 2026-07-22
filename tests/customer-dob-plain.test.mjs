// C-2 REVERSAL PROOF (mig 044) — the legacy customers DOB encryption is undone and a
// plain, directly-readable customers.dob column is restored. Applies the real 042 then
// 044 migrations to an ephemeral Postgres over a minimal fixture mirroring the 001 objects
// they touch, and asserts:
//   • customers has a plain `dob` column again, directly selectable;
//   • an existing encrypted value is RECOVERED into the plain column when the key is present;
//   • dob_enc column and customer_dob_set/customer_dob_get RPCs are GONE;
//   • birth_month/day + age still derive from the plain dob (renewals/birthday keep working);
//   • 044 runs with NO key set (recovery is a no-op, no guard, no error).
// The spine's household_members DOB encryption (mig 011) is a separate subsystem, untouched.
// Mirrors tests/rls-firewall.test.mjs' ephemeral-Postgres harness.
// Run: node tests/customer-dob-plain.test.mjs
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
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  process.exit(0)
}

const D = '/tmp/fsos-dobplain'
const L = '/tmp/fsos-dobplain-log'
const P = '55459'
const H = L
const KEY = 'test-dob-key-0123456789'
const CID = '11111111-1111-1111-1111-111111111111'

function apply(dbName, file, withKey) {
  const env = withKey ? `env PGOPTIONS="-c app.dob_key=${KEY}"` : ''
  sh(`runuser -u postgres -- ${env} psql -h ${H} -p ${P} -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -q -f ${file}`)
}
function q(dbName, sql) {
  return sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`)
    .trim().split('\n').pop()
}

const results = []
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) }
}

function writeFixture(path, seedPlaintext) {
  writeFileSync(path, `
    create extension if not exists pgcrypto;
    create table customers (
      customer_id uuid primary key default gen_random_uuid(),
      first_name text, last_name text, dob date, age integer
    );
    create or replace function encrypt_dob(d date, key text) returns bytea language sql volatile as $$ select pgp_sym_encrypt(d::text, key); $$;
    create or replace function decrypt_dob(e bytea, key text) returns date language sql stable as $$ select nullif(pgp_sym_decrypt(e, key), '')::date; $$;
    create or replace function set_customer_age() returns trigger language plpgsql as $$
      begin new.age := case when new.dob is null then null else date_part('year', age(new.dob))::integer end; return new; end; $$;
    create trigger customers_set_age before insert or update of dob on customers
      for each row execute function set_customer_age();
    create or replace function run_nightly_scoring() returns void language plpgsql as $$
      begin update customers set age = date_part('year', age(dob))::integer where dob is not null; end; $$;
    ${seedPlaintext ? `insert into customers (customer_id, first_name, dob) values ('${CID}', 'Legacy', date '1980-05-15');` : ''}
  `)
}

console.log('C-2 reversal — restore plain customers.dob (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')

  // ── DB1: seed plaintext → encrypt (042) → revert with key (044): value RECOVERED. ──
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres db1`)
  writeFixture(`${L}/fx1.sql`, true)
  apply('db1', `${L}/fx1.sql`, false)
  apply('db1', 'supabase/migrations/042_legacy_customer_pii_firewall.sql', true) // encrypt (drops plain dob)
  apply('db1', 'supabase/migrations/044_revert_customer_dob_encryption.sql', true) // revert (recovers)

  check('plain dob column is restored', () => {
    assert.equal(q('db1', `select count(*) from information_schema.columns where table_name='customers' and column_name='dob'`), '1')
  })
  check('dob_enc column is gone', () => {
    assert.equal(q('db1', `select count(*) from information_schema.columns where table_name='customers' and column_name='dob_enc'`), '0')
  })
  check('customer_dob_set / customer_dob_get RPCs are gone', () => {
    assert.equal(q('db1', `select count(*) from pg_proc where proname in ('customer_dob_set','customer_dob_get')`), '0')
  })
  check('existing encrypted value RECOVERED into the plain column (directly readable)', () => {
    assert.equal(q('db1', `select dob from customers where customer_id='${CID}'`), '1980-05-15')
  })
  check('birth_month/day + age still derive from the plain dob', () => {
    assert.equal(q('db1', `select birth_month from customers where customer_id='${CID}'`), '5')
    assert.equal(q('db1', `select birth_day from customers where customer_id='${CID}'`), '15')
    const age = Number(q('db1', `select age from customers where customer_id='${CID}'`))
    assert.ok(age >= 40 && age <= 60, `age=${age}`)
  })
  check('a NEW plain dob write maintains age + birth parts via the restored trigger', () => {
    q('db1', `insert into customers (customer_id, first_name, dob) values ('22222222-2222-2222-2222-222222222222','New', date '1990-11-03')`)
    assert.equal(q('db1', `select birth_month from customers where customer_id='22222222-2222-2222-2222-222222222222'`), '11')
    assert.equal(q('db1', `select birth_day from customers where customer_id='22222222-2222-2222-2222-222222222222'`), '3')
  })
  check('run_nightly_scoring reads the plain dob again', () => {
    // position(...) keeps the answer on a single line (the def itself is multi-line).
    assert.equal(
      q('db1', `select (position('age(dob)' in pg_get_functiondef('run_nightly_scoring()'::regprocedure)) > 0)`),
      't',
      'run_nightly_scoring should reference age(dob) after the revert',
    )
  })

  // ── DB2: encrypt (042) → revert with NO key: runs cleanly, dob present (null), dob_enc gone. ──
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres db2`)
  writeFixture(`${L}/fx2.sql`, true)
  apply('db2', `${L}/fx2.sql`, false)
  apply('db2', 'supabase/migrations/042_legacy_customer_pii_firewall.sql', true)
  check('044 runs with NO DOB key (no guard, no error); dob restored, dob_enc dropped', () => {
    apply('db2', 'supabase/migrations/044_revert_customer_dob_encryption.sql', false) // no key
    assert.equal(q('db2', `select count(*) from information_schema.columns where table_name='customers' and column_name='dob'`), '1', 'dob column present')
    assert.equal(q('db2', `select count(*) from information_schema.columns where table_name='customers' and column_name='dob_enc'`), '0', 'dob_enc dropped')
    // Without the key the encrypted value cannot be recovered — stays null (no crash).
    assert.equal(q('db2', `select coalesce(dob::text,'NULL') from customers where customer_id='${CID}'`), 'NULL')
  })

  // ── DB3: apply 042 with NO key → must NOT fail closed (key-optional per owner decision,
  //    mig 044). The plaintext dob is PRESERVED (not encrypted, not dropped) and the chain
  //    continues; 044 (no key) then finalizes the plain-dob state. Regression proof for the
  //    keyless migration-chain unblock. ──
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres db3`)
  writeFixture(`${L}/fx3.sql`, true)
  apply('db3', `${L}/fx3.sql`, false)
  check('042 runs with NO DOB key — no fail-closed RAISE; plaintext dob preserved', () => {
    apply('db3', 'supabase/migrations/042_legacy_customer_pii_firewall.sql', false) // NO key — must not raise
    assert.equal(
      q('db3', `select count(*) from information_schema.columns where table_name='customers' and column_name='dob'`),
      '1', 'plain dob column still present after keyless 042 (not dropped)',
    )
    assert.equal(
      q('db3', `select dob from customers where customer_id='${CID}'`),
      '1980-05-15', 'plaintext dob preserved verbatim (never encrypted, never dropped)',
    )
    assert.equal(q('db3', `select birth_month from customers where customer_id='${CID}'`), '5', 'non-PII birthday parts still derived')
    assert.equal(q('db3', `select birth_day from customers where customer_id='${CID}'`), '15')
    assert.equal(q('db3', `select is_security from customers where customer_id='${CID}'`), 'f', 'C-1 is_security firewall column added (default false)')
  })
  check('keyless 042 leaves NO encrypted artifacts (dob_enc empty, not encrypted)', () => {
    // dob_enc column is added (additive) but stays NULL when keyless — nothing was encrypted.
    assert.equal(
      q('db3', `select coalesce((select 1 from customers where customer_id='${CID}' and dob_enc is not null limit 1),0)`),
      '0', 'dob_enc not populated on a keyless run',
    )
  })
  check('044 (no key) finalizes the plain-dob state after a keyless 042', () => {
    apply('db3', 'supabase/migrations/044_revert_customer_dob_encryption.sql', false) // no key
    assert.equal(
      q('db3', `select dob from customers where customer_id='${CID}'`),
      '1980-05-15', 'plaintext dob still directly readable after 044',
    )
    assert.equal(
      q('db3', `select count(*) from information_schema.columns where table_name='customers' and column_name='dob_enc'`),
      '0', 'dob_enc dropped by 044',
    )
  })
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop -m immediate > /dev/null 2>&1`) } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} DOB-revert assertion(s) FAILED.`); process.exit(1) }
console.log(`\nAll ${results.length} DOB-revert proofs passed (mig 044: plain readable customers.dob restored).`)
