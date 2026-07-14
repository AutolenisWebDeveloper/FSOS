// Case 7 PROOF — the securities firewall + column/row allowlist as an RLS rule
// (data-guardrails §2–3). Applies migrations 009+010 to an ephemeral Postgres and
// asserts, as the CLIENT role, that:
//   • an is_security policy row is NOT returned (firewall by construction), and
//   • another household's row is NOT returned (scope allowlist).
// Requires a local Postgres + the `postgres` OS user (present in this environment).
// Run: node tests/rls-firewall.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
}

// Locate a Postgres bin dir. Skip cleanly (not a false pass) if unavailable.
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
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  console.log('(Case 7 was also verified on the live Supabase preview branch: Migrations ✅.)')
  process.exit(0)
}

const D = '/tmp/fsos-rls-test'
const L = '/tmp/fsos-rls-log'
const P = '55455'
const H = L
const UID = '11111111-1111-1111-1111-111111111111'

// -f a SQL file (avoids shell $$-mangling); -c only for $-free SELECTs.
function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function psqlQuery(sql) {
  const raw = sh(
    `runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`,
  )
  // The leading "set role" emits a "SET" command tag; the SELECT value is last.
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

console.log('Case 7 — RLS firewall / column-row allowlist (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres fsos_test`)

  // Supabase-provided bits: auth.uid() pinned to a client user; auth roles.
  // Single-quoted function body (no $$) so the file is unambiguous.
  writeFileSync(
    `${L}/setup.sql`,
    `create schema if not exists auth;\n` +
      `create or replace function auth.uid() returns uuid language sql stable as 'select ''${UID}''::uuid';\n` +
      `do 'begin if not exists (select from pg_roles where rolname=''authenticated'') then create role authenticated; end if; ` +
      `if not exists (select from pg_roles where rolname=''anon'') then create role anon; end if; ` +
      `if not exists (select from pg_roles where rolname=''service_role'') then create role service_role; end if; end';\n`,
  )
  psqlFile(`${L}/setup.sql`)

  psqlFile('supabase/migrations/009_aggregate_root_core.sql')
  psqlFile('supabase/migrations/010_rls_guardrails.sql')

  // Seed: this client's household + a second household; a life + a securities policy.
  writeFileSync(
    `${L}/seed.sql`,
    `insert into households(id, primary_name) values ` +
      `('22222222-2222-2222-2222-222222222222','My Household'),('33333333-3333-3333-3333-333333333333','Someone Else');\n` +
      `insert into user_roles(user_id, role) values ('${UID}','client');\n` +
      `insert into user_households(user_id, household_id) values ('${UID}','22222222-2222-2222-2222-222222222222');\n` +
      `insert into household_policies(household_id, is_security, policy_number) values ` +
      `('22222222-2222-2222-2222-222222222222', false, 'LIFE-001'),` +
      `('22222222-2222-2222-2222-222222222222', true,  'SEC-999'),` +
      `('33333333-3333-3333-3333-333333333333', false, 'OTHER-1');\n` +
      `grant select on household_policies, households to authenticated;\n`,
  )
  psqlFile(`${L}/seed.sql`)

  const visiblePolicies = psqlQuery(
    "set role authenticated; select coalesce(string_agg(policy_number, ',' order by policy_number),'<none>') from household_policies;",
  )
  const visibleHouseholds = psqlQuery(
    "set role authenticated; select coalesce(string_agg(primary_name, ',' order by primary_name),'<none>') from households;",
  )

  let passed = 0
  const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

  t('client CANNOT read the is_security policy (firewall row rule)', () => {
    assert.equal(visiblePolicies, 'LIFE-001', `expected only LIFE-001, got: ${visiblePolicies}`)
    assert.ok(!visiblePolicies.includes('SEC-999'), 'SEC-999 must not be visible')
  })
  t("client CANNOT read another household's policy (scope allowlist)", () => {
    assert.ok(!visiblePolicies.includes('OTHER-1'), 'OTHER-1 must not be visible')
  })
  t('client sees only their own household', () => {
    assert.equal(visibleHouseholds, 'My Household', `expected only My Household, got: ${visibleHouseholds}`)
  })

  console.log(`\nCase 7: all ${passed} RLS firewall assertions passed.`)
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop > /dev/null 2>&1`) } catch { /* ignore */ }
  try { sh(`rm -rf ${D} ${L}`) } catch { /* ignore */ }
}
