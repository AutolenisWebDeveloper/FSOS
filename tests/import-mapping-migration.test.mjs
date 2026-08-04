// Contact Import mapping model — migration 096 proof (ephemeral Postgres).
// Applies a minimal fixture mirroring the prerequisites 096 touches (pgcrypto,
// update_updated_at, has_role/is_super stubs, a contacts stub) then migration 096,
// and asserts:
//   • import_templates / import_header_memory / custom_fields tables exist;
//   • the signature + (entity,key) unique indexes exist;
//   • contacts gains a plain `dob` date column and a `custom` jsonb column;
//   • RLS is enabled on all three registry tables;
//   • authenticated has SELECT but NO insert/update/delete (deny-by-row);
//   • the custom_fields entity + field_type CHECK constraints reject bad values;
//   • re-applying 096 is idempotent (no error).
// Mirrors tests/customer-dob-plain.test.mjs' harness. Run: node tests/import-mapping-migration.test.mjs
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

const D = '/tmp/fsos-mapmig'
const L = '/tmp/fsos-mapmig-log'
const P = '55461'
const H = L

function apply(dbName, file) {
  sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -q -f ${file}`)
}
function q(dbName, sql) {
  return sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`)
    .trim().split('\n').pop()
}
function expectFail(dbName, sql, label) {
  let threw = false
  try { sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d ${dbName} -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(sql)}`) }
  catch { threw = true }
  assert.ok(threw, `${label} should have been rejected by a constraint`)
}

const results = []
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) }
}

function writeFixture(path) {
  writeFileSync(path, `
    create extension if not exists pgcrypto;
    -- shared trigger fn (mirrors 001)
    create or replace function update_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at := now(); return new; end; $$;
    -- rbac stubs (mirror 010 signatures) — return false so read policies deny by default
    create or replace function has_role(r text) returns boolean language sql stable as $$ select false $$;
    create or replace function is_super() returns boolean language sql stable as $$ select false $$;
    create role authenticated nologin;
    create role anon nologin;
    -- minimal contacts stub for the additive ALTERs
    create table contacts (
      id uuid primary key default gen_random_uuid(),
      full_name text not null,
      updated_at timestamptz not null default now()
    );
  `)
}

console.log('Migration 096 — contact-import mapping model (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres db1`)
  writeFixture(`${L}/fx.sql`)
  apply('db1', `${L}/fx.sql`)
  apply('db1', 'supabase/migrations/096_contact_import_mapping_model.sql')

  for (const tbl of ['import_templates', 'import_header_memory', 'custom_fields']) {
    check(`${tbl} table exists`, () => {
      assert.equal(q('db1', `select count(*) from information_schema.tables where table_name='${tbl}'`), '1')
    })
    check(`${tbl} has RLS enabled`, () => {
      assert.equal(q('db1', `select relrowsecurity from pg_class where relname='${tbl}'`), 't')
    })
    check(`${tbl} — authenticated has SELECT but no write`, () => {
      assert.equal(q('db1', `select has_table_privilege('authenticated','${tbl}','select')`), 't', 'select granted')
      for (const priv of ['insert', 'update', 'delete']) {
        assert.equal(q('db1', `select has_table_privilege('authenticated','${tbl}','${priv}')`), 'f', `${priv} must be revoked`)
      }
    })
  }

  check('import_templates.source_signature is unique', () => {
    assert.equal(q('db1', `select count(*) from pg_indexes where tablename='import_templates' and indexname='uq_import_templates_signature'`), '1')
  })
  check('custom_fields (entity,key) is unique', () => {
    assert.equal(q('db1', `select count(*) from pg_indexes where tablename='custom_fields' and indexname='uq_custom_fields_entity_key'`), '1')
  })

  check('contacts gains a plain dob date column', () => {
    assert.equal(q('db1', `select data_type from information_schema.columns where table_name='contacts' and column_name='dob'`), 'date')
  })
  check('contacts gains a custom jsonb column defaulting to {}', () => {
    assert.equal(q('db1', `select data_type from information_schema.columns where table_name='contacts' and column_name='custom'`), 'jsonb')
    q('db1', `insert into contacts (full_name) values ('Test Person')`)
    assert.equal(q('db1', `select custom::text from contacts where full_name='Test Person'`), '{}')
  })

  check('custom_fields rejects an unknown entity', () => {
    expectFail('db1', `insert into custom_fields (entity, key, label) values ('contact','x','X')`, 'bad entity')
  })
  check('custom_fields rejects an unknown field_type', () => {
    expectFail('db1', `insert into custom_fields (entity, key, label, field_type) values ('member','x','X','currency')`, 'bad field_type')
  })
  check('custom_fields accepts a valid definition + enforces (entity,key) uniqueness', () => {
    q('db1', `insert into custom_fields (entity, key, label, field_type) values ('member','widget_score','Widget Score','number')`)
    expectFail('db1', `insert into custom_fields (entity, key, label) values ('member','widget_score','Dup')`, 'duplicate (entity,key)')
  })

  check('re-applying migration 096 is idempotent', () => {
    apply('db1', 'supabase/migrations/096_contact_import_mapping_model.sql')
    assert.equal(q('db1', `select count(*) from information_schema.tables where table_name='import_templates'`), '1')
  })
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop -m immediate > /dev/null 2>&1`) } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} migration assertion(s) FAILED.`); process.exit(1) }
console.log(`\nAll ${results.length} migration-096 proofs passed.`)
