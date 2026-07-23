// D0 ROLLBACK PROOF — the opt-out import is cleanly reversible and never touches
// native (non-migration) consent/suppression rows. On an ephemeral Postgres:
//   1. seed a household + member,
//   2. write a NATIVE opt-out (inbound STOP) — consents.revoked + dnc_entries,
//   3. simulate the D0 import — marker-tagged ghl_migration rows,
//   4. run scripts/ghl-migration/rollback-optouts.sql,
//   5. assert every ghl_migration row is gone AND the native rows are untouched
//      (row counts back to the pre-import baseline).
// Mirrors tests/rls-firewall.test.mjs' ephemeral-PG harness; skips cleanly when
// Postgres/the postgres user is unavailable, UNLESS CI_REQUIRE_INFRA=1.
// Run: node tests/ghl-optout-rollback.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'

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

const D = '/tmp/fsos-optout-rb-data'
const L = '/tmp/fsos-optout-rb-log'
const P = '55456'
const H = L

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function scalar(sql) {
  const raw = sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`)
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? ''
}

console.log('D0 — opt-out import rollback (ephemeral Postgres)')
let failed = false
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres fsos_test`)

  // Minimal schema matching the columns consents/dnc_entries expose in migration 009.
  const schema = `${L}/schema.sql`
  writeFileSync(schema, `
    create table households (id uuid primary key default gen_random_uuid());
    create table household_members (id uuid primary key default gen_random_uuid(),
      household_id uuid references households(id) on delete cascade, email text, phone text);
    create table consents (
      id uuid primary key default gen_random_uuid(),
      member_id uuid references household_members(id) on delete cascade,
      household_id uuid references households(id) on delete cascade,
      channel text not null, status text not null default 'granted',
      source text, captured_at timestamptz, unique(member_id, channel));
    create table dnc_entries (
      id uuid primary key default gen_random_uuid(),
      contact text not null, channel text not null, scope text not null default 'internal',
      reason text, created_at timestamptz default now(), unique(contact, channel));
    -- seed a household + member (the native/existing contact)
    insert into households (id) values ('11111111-1111-1111-1111-111111111111');
    insert into household_members (id, household_id, email, phone)
      values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','native@x.com','+15550000001');
    -- (2) NATIVE opt-out already on file (inbound STOP): must survive rollback.
    insert into consents (member_id, household_id, channel, status, source)
      values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','sms','revoked','inbound_stop');
    insert into dnc_entries (contact, channel, scope, reason)
      values ('+15550000001','sms','internal','inbound STOP');
  `)
  psqlFile(schema)

  const baseConsents = Number(scalar('select count(*) from consents'))
  const baseDnc = Number(scalar('select count(*) from dnc_entries'))
  assert.equal(baseConsents, 1); assert.equal(baseDnc, 1)

  // (3) Simulate the D0 import — marker-tagged ghl_migration rows (a different member + contact).
  const imp = `${L}/import.sql`
  writeFileSync(imp, `
    insert into households (id) values ('33333333-3333-3333-3333-333333333333');
    insert into household_members (id, household_id, email, phone)
      values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','ghl@x.com','+15550000002');
    insert into consents (member_id, household_id, channel, status, source, captured_at)
      values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','sms','revoked','ghl_migration','2025-01-01T00:00:00Z')
      on conflict (member_id, channel) do nothing;
    insert into dnc_entries (contact, channel, scope, reason, created_at)
      values ('+15550000002','sms','internal','ghl_migration','2025-01-01T00:00:00Z')
      on conflict (contact, channel) do nothing;
  `)
  psqlFile(imp)
  assert.equal(Number(scalar('select count(*) from consents')), baseConsents + 1, 'import added a consent row')
  assert.equal(Number(scalar('select count(*) from dnc_entries')), baseDnc + 1, 'import added a dnc row')

  // (4) Run the actual rollback SQL shipped in the repo.
  psqlFile('scripts/ghl-migration/rollback-optouts.sql')

  // (5) ghl_migration rows gone; native rows untouched; back to baseline.
  assert.equal(Number(scalar("select count(*) from consents where source='ghl_migration'")), 0, 'migration consents removed')
  assert.equal(Number(scalar("select count(*) from dnc_entries where reason='ghl_migration'")), 0, 'migration dnc removed')
  assert.equal(Number(scalar('select count(*) from consents')), baseConsents, 'consents back to baseline')
  assert.equal(Number(scalar('select count(*) from dnc_entries')), baseDnc, 'dnc back to baseline')
  assert.equal(Number(scalar("select count(*) from consents where source='inbound_stop'")), 1, 'native consent untouched')
  assert.equal(Number(scalar("select count(*) from dnc_entries where reason='inbound STOP'")), 1, 'native dnc untouched')
  console.log('  ✓ rollback removed only ghl_migration rows; native opt-outs intact; counts at baseline')
} catch (e) {
  failed = true
  console.error(`  ✗ ${e.message}`)
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop -m immediate > /dev/null 2>&1`) } catch { /* ignore */ }
}
console.log(`\nD0 rollback: ${failed ? 'FAILED' : 'passed'}`)
process.exit(failed ? 1 : 0)
