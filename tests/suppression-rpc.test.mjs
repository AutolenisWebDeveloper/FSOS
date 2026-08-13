// Communication-suppression RPC integration proof (ephemeral Postgres). Proves, against a
// real database, the guarantees app code cannot: the comm_suppression_apply RPC performs the
// suppression mutation AND its audit_log row ATOMICALLY (audit failure → the mutation rolls
// back), computes the affected-client count correctly, handles bulk client ops, and RAISES
// (never silently no-ops) on a bad agency / invalid status / empty selection.
//
// Requires a local Postgres + the `postgres` OS user (present in CI infra). Skips cleanly
// otherwise so the unit suite stays runnable. Run: node tests/suppression-rpc.test.mjs
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

const D = '/tmp/fsos-supp-rpc'
const L = '/tmp/fsos-supp-rpc-log'
const P = '55472'
const H = L
const A1 = '00000000-0000-0000-0000-0000000000a1'
const A2 = '00000000-0000-0000-0000-0000000000a2'
const C1 = '00000000-0000-0000-0000-0000000000c1'
const C2 = '00000000-0000-0000-0000-0000000000c2'
const C3 = '00000000-0000-0000-0000-0000000000c3'
const COWNER = '00000000-0000-0000-0000-00000000c0ff'
const CDEL = '00000000-0000-0000-0000-0000000000de'
const ACTOR = '99999999-9999-9999-9999-999999999999'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function psqlErrors(sql) {
  try {
    sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(sql)}`)
    return false
  } catch {
    return true
  }
}
function q(sql) {
  const raw = sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`)
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Communication suppression RPC (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres fsos_test`)

  writeFileSync(
    `${L}/setup.sql`,
    `create schema if not exists auth;\n` +
      `create or replace function auth.uid() returns uuid language sql stable as 'select ''${ACTOR}''::uuid';\n` +
      `create or replace function update_updated_at() returns trigger language plpgsql as 'begin new.updated_at = now(); return new; end';\n` +
      `do 'begin if not exists (select from pg_roles where rolname=''authenticated'') then create role authenticated; end if; ` +
      `if not exists (select from pg_roles where rolname=''anon'') then create role anon; end if; ` +
      `if not exists (select from pg_roles where rolname=''service_role'') then create role service_role; end if; end';\n`,
  )
  psqlFile(`${L}/setup.sql`)
  psqlFile('supabase/migrations/009_aggregate_root_core.sql')
  psqlFile('supabase/migrations/010_rls_guardrails.sql')
  psqlFile('supabase/migrations/026_contacts.sql')
  psqlFile('supabase/migrations/115_communication_suppression.sql')

  // Seed: agency A1 with 3 clients + 1 agency-owner contact (excluded from the book count) +
  // 1 soft-deleted contact (excluded). Agency A2 for the atomicity test.
  writeFileSync(
    `${L}/seed.sql`,
    `insert into agency_partnerships (id, agency_name, owner_name, status) values ('${A1}','A One','Owner A','activated'),('${A2}','A Two','Owner B','activated');\n` +
      `insert into contacts (id, full_name, contact_type, agency_partnership_id) values ` +
      `('${C1}','Client One','client','${A1}'),('${C2}','Client Two','client','${A1}'),('${C3}','Client Three','client','${A1}'),('${COWNER}','The Owner','agency_owner','${A1}');\n` +
      `insert into contacts (id, full_name, contact_type, agency_partnership_id, deleted_at) values ('${CDEL}','Deleted One','client','${A1}', now());\n`,
  )
  psqlFile(`${L}/seed.sql`)

  t('block agency → affected_count excludes owner + soft-deleted (3), row + audit written atomically', () => {
    const affected = q(`select (comm_suppression_apply('agency','blocked','${ACTOR}','partner offboarding','${A1}',null))->>'affected_count'`)
    assert.equal(affected, '3', 'book size = 3 client contacts (owner + deleted excluded)')
    assert.equal(q(`select status from comm_agency_suppressions where agency_id='${A1}'`), 'blocked')
    assert.equal(q(`select affected_count from comm_agency_suppressions where agency_id='${A1}'`), '3')
    assert.equal(q(`select blocked_by from comm_agency_suppressions where agency_id='${A1}'`), ACTOR)
    // Exactly one audit row, with the required fields.
    assert.equal(q(`select count(*) from audit_log where entity='comm_agency_suppression' and entity_id='${A1}'`), '1')
    assert.equal(q(`select diff->>'scope' from audit_log where entity='comm_agency_suppression' and entity_id='${A1}'`), 'agent_book')
    assert.equal(q(`select diff->>'previous_status' from audit_log where entity='comm_agency_suppression' and entity_id='${A1}'`), 'active')
    assert.equal(q(`select diff->>'new_status' from audit_log where entity='comm_agency_suppression' and entity_id='${A1}'`), 'blocked')
    assert.equal(q(`select diff->>'affected_client_count' from audit_log where entity='comm_agency_suppression' and entity_id='${A1}'`), '3')
    assert.equal(q(`select diff->>'reason' from audit_log where entity='comm_agency_suppression' and entity_id='${A1}'`), 'partner offboarding')
  })

  t('unblock agency → status active, unblocked_at set, second audit row', () => {
    q(`select comm_suppression_apply('agency','active','${ACTOR}','partner returned','${A1}',null)`)
    assert.equal(q(`select status from comm_agency_suppressions where agency_id='${A1}'`), 'active')
    assert.notEqual(q(`select coalesce(unblocked_at::text,'') from comm_agency_suppressions where agency_id='${A1}'`), '')
    assert.equal(q(`select count(*) from audit_log where entity='comm_agency_suppression' and entity_id='${A1}'`), '2')
  })

  t('bulk client block → both rows blocked; one audit row with count=2 + contact_ids', () => {
    const affected = q(`select (comm_suppression_apply('client','blocked','${ACTOR}','bulk exclude',null,array['${C1}','${C2}']::uuid[]))->>'affected_count'`)
    assert.equal(affected, '2')
    assert.equal(q(`select count(*) from comm_client_suppressions where status='blocked' and contact_id in ('${C1}','${C2}')`), '2')
    assert.equal(q(`select count(*) from audit_log where entity='comm_client_suppression' and diff->>'scope'='client_bulk'`), '1')
    assert.equal(q(`select diff->>'affected_client_count' from audit_log where entity='comm_client_suppression' and diff->>'scope'='client_bulk'`), '2')
    assert.equal(q(`select (diff->'contact_ids') @> '["${C1}"]'::jsonb from audit_log where diff->>'scope'='client_bulk'`), 't')
  })

  t('single client block → audit scope individual, entity_id = the contact', () => {
    q(`select comm_suppression_apply('client','blocked','${ACTOR}','one off',null,array['${C3}']::uuid[])`)
    assert.equal(q(`select count(*) from audit_log where entity='comm_client_suppression' and entity_id='${C3}' and diff->>'scope'='individual'`), '1')
  })

  t('client unblock does NOT touch any regulatory store (only comm_client_suppressions)', () => {
    q(`select comm_suppression_apply('client','active','${ACTOR}',null,null,array['${C1}']::uuid[])`)
    assert.equal(q(`select status from comm_client_suppressions where contact_id='${C1}'`), 'active')
    // No dnc_entries / consents were created or altered by suppression (separation of layers).
    assert.equal(q(`select count(*) from dnc_entries`), '0')
  })

  t('invalid agency RAISES (never a silent no-op)', () => {
    assert.equal(psqlErrors(`select comm_suppression_apply('agency','blocked','${ACTOR}','x','00000000-0000-0000-0000-0000000000ff',null)`), true)
  })
  t('invalid status RAISES', () => {
    assert.equal(psqlErrors(`select comm_suppression_apply('agency','frozen','${ACTOR}','x','${A1}',null)`), true)
  })
  t('client scope with no valid contacts RAISES', () => {
    assert.equal(psqlErrors(`select comm_suppression_apply('client','blocked','${ACTOR}','x',null,array['00000000-0000-0000-0000-0000000000fe']::uuid[])`), true)
  })
  t('missing actor RAISES', () => {
    assert.equal(psqlErrors(`select comm_suppression_apply('agency','blocked','','x','${A1}',null)`), true)
  })

  t('AUDIT ATOMICITY: if the audit_log insert fails, the suppression mutation ROLLS BACK', () => {
    // Break the audit target, then attempt to block the (so-far untouched) agency A2. The
    // whole SECURITY DEFINER function is one transaction, so the audit failure must abort the
    // suppression upsert too — A2 must have NO row afterward.
    assert.equal(q(`select count(*) from comm_agency_suppressions where agency_id='${A2}'`), '0')
    sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -q -c "alter table audit_log rename to audit_log_hidden"`)
    const raised = psqlErrors(`select comm_suppression_apply('agency','blocked','${ACTOR}','x','${A2}',null)`)
    sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -q -c "alter table audit_log_hidden rename to audit_log"`)
    assert.equal(raised, true, 'the RPC raises when audit cannot be written')
    assert.equal(q(`select count(*) from comm_agency_suppressions where agency_id='${A2}'`), '0', 'the suppression mutation rolled back with the failed audit')
  })

  console.log(`\n✓ suppression RPC: ${passed} proofs passed`)
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop > /dev/null 2>&1`) } catch { /* ignore */ }
}
