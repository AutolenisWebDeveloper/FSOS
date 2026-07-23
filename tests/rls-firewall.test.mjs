// Case 7 PROOF — the securities firewall + column/row allowlist as an RLS rule
// (data-guardrails §2–3). Applies migrations 009+010 (+011/012/013/015 for the
// view checks) to an ephemeral Postgres and asserts, as the CLIENT role, that:
//   • an is_security policy row is NOT returned (firewall by construction), and
//   • another household's row is NOT returned (scope allowlist), and
//   • the SAME two invariants hold when reading through the reporting VIEWS
//     (v_conversions_due / v_policy_lapse_risk / v_pipeline_by_engagement) — the
//     views are security_invoker so the caller's RLS applies. A security_definer
//     view would have leaked exactly the rows RLS hides; that gap is why the
//     Supabase linter caught what our table-only tests didn't.
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
  // In CI this proof MUST run — a missing toolchain is a failure, not a pass.
  // Locally (no CI_REQUIRE_INFRA) we skip cleanly so the suite stays runnable.
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    console.error('The RLS-firewall proof (Case 7) cannot silently skip in CI — provision Postgres.')
    process.exit(1)
  }
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
  // 011/012/013 add the reporting views; 015 flips them to security_invoker.
  psqlFile('supabase/migrations/011_p0_softdelete_views_dob.sql')
  psqlFile('supabase/migrations/012_p1_reviews_comms_commission.sql')
  psqlFile('supabase/migrations/013_p2_operational_enhancement.sql')
  psqlFile('supabase/migrations/015_security_invoker_views.sql')
  // 049 adds the delegation + assignment-review tables (Slice 1). Both are back-office
  // only (no client policy) — the proof below asserts a client sees ZERO rows from each.
  psqlFile('supabase/migrations/049_comm_delegation_ownership.sql')

  // Seed: this client's household + a second household; a life + a securities policy.
  // conversion_deadline/is_with_us are set so every policy also surfaces in the
  // reporting views (v_conversions_due / v_policy_lapse_risk) — otherwise the view
  // checks below would pass vacuously (0 rows for everyone).
  writeFileSync(
    `${L}/seed.sql`,
    `insert into households(id, primary_name) values ` +
      `('22222222-2222-2222-2222-222222222222','My Household'),('33333333-3333-3333-3333-333333333333','Someone Else');\n` +
      `insert into user_roles(user_id, role) values ('${UID}','client');\n` +
      `insert into user_households(user_id, household_id) values ('${UID}','22222222-2222-2222-2222-222222222222');\n` +
      `insert into household_policies(household_id, is_security, policy_number, is_with_us, status, conversion_deadline, renewal_date) values ` +
      `('22222222-2222-2222-2222-222222222222', false, 'LIFE-001', true, 'active', current_date + 20, current_date + 10),` +
      `('22222222-2222-2222-2222-222222222222', true,  'SEC-999',  true, 'active', current_date + 20, current_date + 10),` +
      `('33333333-3333-3333-3333-333333333333', false, 'OTHER-1',  true, 'active', current_date + 20, current_date + 10);\n` +
      // Opportunities are FSA/staff-only (no client RLS policy at all), so a client
      // reading v_pipeline_by_engagement must see ZERO rows — including the is_security one.
      `insert into opportunities(household_id, engagement, stage, is_security) values ` +
      `('22222222-2222-2222-2222-222222222222','warm_handoff','prospect', false),` +
      `('22222222-2222-2222-2222-222222222222','direct','fact_find', true);\n` +
      `grant select on household_policies, households, opportunities to authenticated;\n` +
      `grant select on v_conversions_due, v_policy_lapse_risk, v_pipeline_by_engagement to authenticated;\n` +
      // Slice 1 (mig 049): a delegation + an assignment-review row. Both back-office;
      // a client must see NEITHER (default-deny RLS, no client policy) even with grant.
      `insert into agency_partnerships(id, agency_name, owner_name) values ` +
      `('44444444-4444-4444-4444-444444444444','Test Agency','Owner One');\n` +
      `insert into agency_owners(id, agency_id, full_name) values ` +
      `('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','Owner One');\n` +
      `insert into agency_communication_delegations(agency_id, agency_owner_id, status) values ` +
      `('44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555','ACTIVE');\n` +
      `insert into comm_assignment_reviews(channel, destination, household_id, reason) values ` +
      `('sms','+15550100','22222222-2222-2222-2222-222222222222','ownership unresolved: no agency owner');\n` +
      `grant select on agency_communication_delegations, comm_assignment_reviews to authenticated;\n`,
  )
  psqlFile(`${L}/seed.sql`)

  const visiblePolicies = psqlQuery(
    "set role authenticated; select coalesce(string_agg(policy_number, ',' order by policy_number),'<none>') from household_policies;",
  )
  const visibleHouseholds = psqlQuery(
    "set role authenticated; select coalesce(string_agg(primary_name, ',' order by primary_name),'<none>') from households;",
  )

  // Same firewall/scope invariants, but read through the reporting VIEWS. Because
  // the views are security_invoker, the caller's RLS applies to view reads too.
  const viewConversions = psqlQuery(
    "set role authenticated; select coalesce(string_agg(policy_number, ',' order by policy_number),'<none>') from v_conversions_due;",
  )
  const viewLapseRisk = psqlQuery(
    "set role authenticated; select coalesce(string_agg(policy_number, ',' order by policy_number),'<none>') from v_policy_lapse_risk;",
  )
  const viewPipelineRows = psqlQuery(
    'set role authenticated; select count(*) from v_pipeline_by_engagement;',
  )

  // Slice 1 (mig 049): client must see zero delegation / assignment-review rows.
  const visibleDelegations = psqlQuery(
    'set role authenticated; select count(*) from agency_communication_delegations;',
  )
  const visibleAssignments = psqlQuery(
    'set role authenticated; select count(*) from comm_assignment_reviews;',
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

  // ── VIEW checks — the security_definer_view finding the linter caught. ──
  t('v_conversions_due (view) hides the is_security row (firewall holds on views)', () => {
    assert.ok(!viewConversions.includes('SEC-999'), `SEC-999 must not be visible via view, got: ${viewConversions}`)
    assert.equal(viewConversions, 'LIFE-001', `expected only LIFE-001 via view, got: ${viewConversions}`)
  })
  t("v_conversions_due (view) hides another household's row (scope holds on views)", () => {
    assert.ok(!viewConversions.includes('OTHER-1'), `OTHER-1 must not be visible via view, got: ${viewConversions}`)
  })
  t('v_policy_lapse_risk (view) hides the is_security and other-household rows', () => {
    assert.equal(viewLapseRisk, 'LIFE-001', `expected only LIFE-001 via view, got: ${viewLapseRisk}`)
    assert.ok(!viewLapseRisk.includes('SEC-999'), 'SEC-999 must not be visible via view')
    assert.ok(!viewLapseRisk.includes('OTHER-1'), 'OTHER-1 must not be visible via view')
  })
  t('v_pipeline_by_engagement (view) returns NO opportunity rows to a client', () => {
    // Client has no RLS read path to opportunities at all; the view must not
    // become a back door (including for the is_security opportunity).
    assert.equal(viewPipelineRows, '0', `expected 0 pipeline rows via view, got: ${viewPipelineRows}`)
  })

  t('client CANNOT read agency_communication_delegations (back-office default-deny, mig 049)', () => {
    assert.equal(visibleDelegations, '0', `expected 0 delegations to a client, got: ${visibleDelegations}`)
  })
  t('client CANNOT read comm_assignment_reviews (back-office default-deny, mig 049)', () => {
    assert.equal(visibleAssignments, '0', `expected 0 assignment reviews to a client, got: ${visibleAssignments}`)
  })

  console.log(`\nCase 7: all ${passed} RLS firewall assertions passed.`)
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop > /dev/null 2>&1`) } catch { /* ignore */ }
  try { sh(`rm -rf ${D} ${L}`) } catch { /* ignore */ }
}
