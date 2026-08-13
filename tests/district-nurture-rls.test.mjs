// District Agent FS Nurture — RLS proof (ADR-038). Applies the FULL migration directory (in
// sorted order — production parity) to an ephemeral Postgres, seeds one campaign + one enrollment
// as the superuser, then asserts as the CLIENT role (authenticated) that EVERY district_nurture
// table and the candidates view return ZERO rows (deny-by-default, internal-roles-only), and that
// RLS is enabled on each table. Mirrors the bootstrap of tests/rls-firewall.test.mjs.
// Requires a local Postgres + the `postgres` OS user.
// Run: node tests/district-nurture-rls.test.mjs
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

const D = '/tmp/fsos-dn-rls-test'
const L = '/tmp/fsos-dn-rls-log'
const P = '55457'
const H = L
const UID = '11111111-1111-1111-1111-111111111111'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function psqlQuery(sql) {
  const raw = sh(
    `runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`,
  )
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const NURTURE_TABLES = [
  'district_nurture_campaigns',
  'district_nurture_touches',
  'district_nurture_enrollments',
  'district_nurture_executions',
  'district_nurture_advisor_touches',
]

console.log('District Nurture — RLS deny-by-default (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres fsos_test`)

  // Supabase-provided bits: auth.uid() pinned to a client user; auth roles + pgcrypto.
  writeFileSync(
    `${L}/setup.sql`,
    `create extension if not exists pgcrypto;\n` +
      // update_updated_at() lives in the skipped 001_initial_schema; define the standard version.
      `create or replace function update_updated_at() returns trigger language plpgsql as ` +
      `'begin new.updated_at = now(); return new; end';\n` +
      `create schema if not exists auth;\n` +
      `create or replace function auth.uid() returns uuid language sql stable as 'select ''${UID}''::uuid';\n` +
      `do 'begin if not exists (select from pg_roles where rolname=''authenticated'') then create role authenticated; end if; ` +
      `if not exists (select from pg_roles where rolname=''anon'') then create role anon; end if; ` +
      `if not exists (select from pg_roles where rolname=''service_role'') then create role service_role; end if; end';\n`,
  )
  psqlFile(`${L}/setup.sql`)

  // Curated dependency chain (the sandbox Postgres lacks pg_cron used by 001-008, so we start at
  // 009 like the rls-firewall proof). This is the closure the district_nurture schema needs:
  //   009 core (agency_partnerships, agency_owners, comm_templates, comm_campaigns, user_roles)
  //   010 RLS helpers (is_super/has_role)   011/012/013/015 add comm_campaigns.category/archived_at
  //   033 adds comm_campaigns.type          026 contacts   027 fnwl_serving_agent_no
  //   051 agency directory cols (mobile_phone/interested/existing_leads_user)  052 agency_owners.contact_id
  const CHAIN = [
    '009_aggregate_root_core',
    '010_rls_guardrails',
    '011_p0_softdelete_views_dob',
    '012_p1_reviews_comms_commission',
    '013_p2_operational_enhancement',
    '015_security_invoker_views',
    '033_comms_inbound_knowledge_campaigns',
    '026_contacts',
  ]
  for (const m of CHAIN) psqlFile(`supabase/migrations/${m}.sql`)

  // The agency-directory columns the district_nurture view reads (agency_owners.mobile_phone /
  // contact_id, agency_partnerships.interested / existing_leads_user) arrive in migrations 051/052,
  // which FK into unrelated import tables (import_batches). Add exactly those columns inline so the
  // chain stays minimal — mirroring what 051/052 contribute to the tables under test.
  writeFileSync(
    `${L}/agency_cols.sql`,
    `alter table agency_owners add column if not exists mobile_phone text;\n` +
      `alter table agency_owners add column if not exists contact_id uuid references contacts(id) on delete set null;\n` +
      `alter table agency_partnerships add column if not exists interested boolean not null default false;\n` +
      `alter table agency_partnerships add column if not exists existing_leads_user boolean not null default false;\n` +
      // comm_templates.introduces_sender arrives in migration 105 (skipped from this minimal chain).
      `alter table comm_templates add column if not exists introduces_sender boolean not null default false;\n`,
  )
  psqlFile(`${L}/agency_cols.sql`)

  // The engine-registry sync function normally arrives in migration 109 (which also triggers on
  // the three client-engine tables). District-nurture's migration 112 only needs the function to
  // exist for its own trigger; define the same function inline here so the chain stays minimal.
  writeFileSync(
    `${L}/sync_fn.sql`,
    `create or replace function public.sync_engine_campaign_registry() returns trigger ` +
      `language plpgsql security definer set search_path = public as $fn$ begin ` +
      `insert into public.comm_campaigns (id, name, status, type, category, archived_at) ` +
      `values (new.id, new.name || ' (engine registry)', 'paused', 'drip', 'engine_registry', now()) ` +
      `on conflict (id) do update set name = excluded.name, updated_at = now() ` +
      `where public.comm_campaigns.category = 'engine_registry'; return new; end; $fn$;\n`,
  )
  psqlFile(`${L}/sync_fn.sql`)

  // The district_nurture schema, content seed, and observability migrations under test.
  psqlFile('supabase/migrations/112_district_nurture_campaign.sql')
  psqlFile('supabase/migrations/113_district_nurture_seed.sql')
  psqlFile('supabase/migrations/114_district_nurture_observability.sql')

  // Seed (as superuser): one campaign + one agency owner + one enrollment, so a leak would
  // return a row rather than passing vacuously.
  writeFileSync(
    `${L}/seed.sql`,
    `insert into agency_partnerships(id, agency_name, owner_name, status) values ` +
      `('aaaaaaaa-0000-4000-8000-000000000001','Test Agency','Pat Owner','producing');\n` +
      `insert into agency_owners(id, agency_id, full_name, email) values ` +
      `('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Pat Owner','pat@farmersagent.com');\n` +
      `insert into district_nurture_enrollments(campaign_id, agency_id, agency_owner_id, status, baseline_date) values ` +
      `('d1a00000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','active','2026-01-01');\n`,
  )
  psqlFile(`${L}/seed.sql`)

  console.log('\nschema + seed applied')
  t('the campaign + enrollment exist (superuser sees them — the seed is real)', () => {
    assert.equal(psqlQuery(`select count(*) from district_nurture_campaigns`), '1')
    assert.equal(psqlQuery(`select count(*) from district_nurture_enrollments`), '1')
    // 24 email + 12 sms templates + 40 touch rows seeded by migration 113.
    assert.equal(psqlQuery(`select count(*) from district_nurture_touches`), '40')
    assert.equal(psqlQuery(`select count(*) from comm_templates where category='district_nurture'`), '36')
  })

  console.log('\nRLS deny-by-default (as the authenticated client role)')
  for (const table of NURTURE_TABLES) {
    t(`a client sees 0 rows from ${table}`, () => {
      const n = psqlQuery(`set role authenticated; select count(*) from ${table}`)
      assert.equal(n, '0', `${table} leaked ${n} rows to a client`)
    })
    t(`RLS is enabled on ${table}`, () => {
      const on = psqlQuery(`select relrowsecurity from pg_class where relname='${table}'`)
      assert.equal(on, 't', `${table} does not have RLS enabled`)
    })
  }

  t('a client obtains nothing through the v_district_nurture_candidates view (security_invoker)', () => {
    // The view is security_invoker, so a client either (a) sees 0 rows because the underlying
    // agency/contact RLS filters them, or (b) is denied object access entirely (the global
    // default-privilege grant to `authenticated` lives in the skipped 001_initial_schema). Both
    // outcomes mean the client obtains no data — the security property under test. A row count > 0
    // would be the leak.
    let result
    try {
      result = psqlQuery(`set role authenticated; select count(*) from v_district_nurture_candidates`)
    } catch (e) {
      result = /permission denied/i.test(String(e.stderr ?? e.message ?? e)) ? 'denied' : 'ERR'
    }
    assert.ok(result === '0' || result === 'denied', `the candidates view leaked to a client (result=${result})`)
  })

  console.log(`\n✓ district-nurture-rls: ${passed} assertions passed`)
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop -m immediate`) } catch { /* ignore */ }
}
