// ROLLBACK PROOF for the automation-audit migrations (137, 138, 139, 140, 141).
// The brief requires every schema change to ship "with a tested rollback". Each of these files
// documents its rollback as a `-- ROLLBACK:` comment block; this proof applies the whole chain to
// an ephemeral Postgres, EXECUTES each block, asserts the schema/data are back to the prior shape,
// then re-applies the migration and asserts the forward state again (so deploy → rollback →
// redeploy is safe). Same toolchain and skip rules as tests/migration-chain.test.mjs.
// 137's own ROLLBACK comment overwrites operator-tuned values, so the runbook carries a guarded one
// (docs/ops/migration-runbook.md, the block after `<!-- rollback:137 -->`); that exact block is
// what runs here. 140's rollback drops the table and with it 141's row, so 141 is re-applied after
// 140 (follow-up M7).
// Registered in the `rls` set (scripts/run-tests.mjs). Run: node tests/automation-migrations-rollback.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
}
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
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  process.exit(0)
}

const D = '/tmp/fsos-audrb-data'
const L = '/tmp/fsos-audrb-log'
const P = '55471'
const DB = 'fsos_audrb'
const URL = `postgresql://postgres@/${DB}?host=${L}&port=${P}`
const psql = (args) => sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ${DB} -v ON_ERROR_STOP=1 ${args}`)
function q(sql) {
  const lines = psql(`-t -A -c ${JSON.stringify(sql)}`).split('\n').map((s) => s.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}
function runFile(path) { psql(`-q -f ${path}`) }

/** The SQL of a migration's `-- ROLLBACK:` block (comment lines up to the first non-comment line). */
function rollbackSql(file) {
  const lines = readFileSync(`supabase/migrations/${file}`, 'utf8').split('\n')
  const i = lines.findIndex((l) => /^--\s*ROLLBACK:/.test(l))
  assert.ok(i >= 0, `${file} has no ROLLBACK block`)
  const body = []
  for (const l of lines.slice(i + 1)) {
    if (!l.startsWith('--')) break
    body.push(l.replace(/^--\s?/, ''))
  }
  const sql = body.join('\n').trim()
  assert.ok(sql.length > 0, `${file} ROLLBACK block is empty`)
  return sql
}
/** The SQL of the runbook's fenced block that follows `<!-- ${marker} -->`. */
function runbookSql(marker) {
  const doc = readFileSync('docs/ops/migration-runbook.md', 'utf8')
  const i = doc.indexOf(`<!-- ${marker} -->`)
  assert.ok(i >= 0, `runbook has no <!-- ${marker} --> block`)
  const m = /```sql\n([\s\S]*?)```/.exec(doc.slice(i))
  assert.ok(m, `runbook <!-- ${marker} --> is not followed by a sql block`)
  return m[1]
}
function runSql(sql) {
  writeFileSync(`${L}/rb.sql`, sql + '\n')
  sh(`chown postgres:postgres ${L}/rb.sql`)
  runFile(`${L}/rb.sql`)
}
function runRollback(file) {
  writeFileSync(`${L}/rb.sql`, rollbackSql(file) + '\n')
  sh(`chown postgres:postgres ${L}/rb.sql`)
  runFile(`${L}/rb.sql`)
}
function reapply(file) {
  writeFileSync(`${L}/re.sql`, readFileSync(`supabase/migrations/${file}`, 'utf8'))
  sh(`chown postgres:postgres ${L}/re.sql`)
  runFile(`${L}/re.sql`)
}
const col = (t, c) => q(`select count(*) from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}'`)
const table = (t) => q(`select count(*) from information_schema.tables where table_schema='public' and table_name='${t}'`)

let failures = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓', name) } catch (e) { failures++; console.log('  ✗', name + ':', e.message) }
}

console.log('Automation-audit migrations — forward, rollback, re-apply')
try {
  const extDir = `/usr/share/postgresql/${PGVER}/extension`
  if (!existsSync(`${extDir}/pg_cron.control`)) {
    try {
      writeFileSync(`${extDir}/pg_cron.control`, "comment = 'no-op pg_cron stub'\ndefault_version = '1.0'\nrelocatable = false\nschema = cron\n")
      writeFileSync(`${extDir}/pg_cron--1.0.sql`,
        `create function schedule(job_name text, schedule text, command text) returns bigint language sql as 'select 1::bigint';\n` +
          `create function schedule(schedule text, command text) returns bigint language sql as 'select 1::bigint';\n` +
          `create function unschedule(job_id bigint) returns boolean language sql as 'select true';\n` +
          `create function unschedule(job_name text) returns boolean language sql as 'select true';\n`)
    } catch (e) {
      const msg = `cannot stub pg_cron (${e.message}) — run as root/sudo.`
      if (process.env.CI_REQUIRE_INFRA === '1') { console.error('FAIL: ' + msg); process.exit(1) }
      console.log('SKIP: ' + msg); process.exit(0)
    }
  }
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres ${DB}`)
  writeFileSync(`${L}/setup.sql`,
    `create schema if not exists auth;\ncreate schema if not exists storage;\ncreate extension if not exists pgcrypto;\n` +
      `create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';\n` +
      `create or replace function auth.role() returns text language sql stable as 'select current_user::text';\n` +
      `create or replace function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';\n` +
      `create table if not exists storage.buckets (id text primary key, name text, public boolean default false);\n` +
      `do 'begin if not exists (select from pg_roles where rolname=''authenticated'') then create role authenticated; end if; ` +
      `if not exists (select from pg_roles where rolname=''anon'') then create role anon; end if; ` +
      `if not exists (select from pg_roles where rolname=''service_role'') then create role service_role; end if; end';\n`)
  runFile(`${L}/setup.sql`)
  sh(`node scripts/migrate.mjs`, { env: { ...process.env, DATABASE_URL: URL }, maxBuffer: 64 * 1024 * 1024 })

  // ── 137 reminder cadence (the runbook's guarded rollback) ──
  const cadence = () => q(`select offsets_minutes::text || '|' || (select max_sms_per_day || '/' || max_combined_touches_per_day from comm_frequency_policy where id='appointment') from booking_reminder_config where id='global'`)
  check('137 forward: 24h + 12h + 1h offsets, appointment caps 6/12', () => {
    assert.equal(cadence(), '{1440,720,60}|6/12')
  })
  check('137 runbook rollback restores {1440} and 4/8; re-apply returns to the forward state', () => {
    runSql(runbookSql('rollback:137'))
    assert.equal(cadence(), '{1440}|4/8')
    assert.match(q(`select column_default from information_schema.columns where table_name='booking_reminder_config' and column_name='offsets_minutes'`), /\{1440\}/)
    assert.equal(q(`select count(*) from schema_migrations where filename='137_booking_reminder_cadence.sql'`), '0')
    reapply('137_booking_reminder_cadence.sql')
    assert.equal(cadence(), '{1440,720,60}|6/12')
  })
  check('137 runbook rollback leaves operator-tuned values alone (and re-apply does too)', () => {
    q(`update booking_reminder_config set offsets_minutes='{1440,120}' where id='global'`)
    q(`update comm_frequency_policy set max_sms_per_day=5, max_combined_touches_per_day=10 where id='appointment'`)
    q(`alter table booking_reminder_config alter column offsets_minutes set default '{1440,180}'`)
    runSql(runbookSql('rollback:137'))
    assert.equal(cadence(), '{1440,120}|5/10', 'the rollback overwrote an operator value')
    assert.match(q(`select column_default from information_schema.columns where table_name='booking_reminder_config' and column_name='offsets_minutes'`), /\{1440,180\}/, 'the rollback overwrote an operator-set default')
    reapply('137_booking_reminder_cadence.sql')
    assert.equal(cadence(), '{1440,120}|5/10', 're-apply overwrote an operator value')
    q(`update booking_reminder_config set offsets_minutes='{1440,720,60}' where id='global'`)
    q(`update comm_frequency_policy set max_sms_per_day=6, max_combined_touches_per_day=12 where id='appointment'`)
  })

  // ── 141 engine_retry_redispatch switch seed (rolled back BEFORE 140, which drops the table) ──
  check('141 forward: engine_retry_redispatch seeded OFF; rollback removes only that row; re-apply restores it', () => {
    assert.equal(q(`select mode from automation_switches where key='engine_retry_redispatch'`), 'off')
    runRollback('141_engine_retry_redispatch_switch.sql')
    assert.equal(q(`select count(*) from automation_switches where key='engine_retry_redispatch'`), '0')
    assert.equal(q(`select mode from automation_switches where key='callback_engine_state'`), 'off', 'the rollback touched another switch')
    reapply('141_engine_retry_redispatch_switch.sql')
    assert.equal(q(`select mode from automation_switches where key='engine_retry_redispatch'`), 'off')
  })

  // ── 140 automation_switches ──
  check('140 forward: table exists, RLS on, callback_engine_state seeded OFF', () => {
    assert.equal(table('automation_switches'), '1')
    assert.equal(q(`select relrowsecurity::text from pg_class where relname='automation_switches'`), 'true')
    assert.equal(q(`select mode from automation_switches where key='callback_engine_state'`), 'off')
  })
  check('140 rejects a mode outside off/canary/on', () => {
    assert.throws(() => q(`insert into automation_switches (key, mode) values ('x', 'enabled')`))
  })
  check('140 rollback drops the table; re-apply restores it (still OFF)', () => {
    runRollback('140_automation_switches.sql')
    assert.equal(table('automation_switches'), '0')
    reapply('140_automation_switches.sql')
    assert.equal(q(`select mode from automation_switches where key='callback_engine_state'`), 'off')
    // Dropping the table removed 141's row too; 140 alone does not re-seed it (runbook §4).
    assert.equal(q(`select count(*) from automation_switches where key='engine_retry_redispatch'`), '0')
    reapply('141_engine_retry_redispatch_switch.sql')
    assert.equal(q(`select mode from automation_switches where key='engine_retry_redispatch'`), 'off')
  })

  // ── 139 campaign purpose ──
  const purposes = () => q(`select coalesce((select string_agg(distinct purpose, ',') from life_campaigns), '-') || '|' || coalesce((select string_agg(distinct purpose, ',') from xsell_life_campaigns), '-')`)
  check('139 forward: life and cross-sell campaigns are MARKETING (rows and defaults)', () => {
    assert.match(q(`select column_default from information_schema.columns where table_name='life_campaigns' and column_name='purpose'`), /MARKETING/)
    assert.match(q(`select column_default from information_schema.columns where table_name='xsell_life_campaigns' and column_name='purpose'`), /MARKETING/)
    for (const p of purposes().split('|')) assert.ok(p === 'MARKETING' || p === '-', purposes())
  })
  check('139 rollback restores the prior purposes and defaults; re-apply returns to MARKETING', () => {
    runRollback('139_campaign_purpose_marketing.sql')
    assert.match(q(`select column_default from information_schema.columns where table_name='life_campaigns' and column_name='purpose'`), /POLICY_DEADLINE/)
    assert.match(q(`select column_default from information_schema.columns where table_name='xsell_life_campaigns' and column_name='purpose'`), /CLIENT_CARE_CROSS_SELL/)
    assert.doesNotMatch(purposes(), /MARKETING/)
    reapply('139_campaign_purpose_marketing.sql')
    for (const p of purposes().split('|')) assert.ok(p === 'MARKETING' || p === '-', purposes())
  })

  // ── 138 DNC lift marker ──
  check('138 forward: dnc_entries.lifted_at / lifted_reason exist', () => {
    assert.equal(col('dnc_entries', 'lifted_at'), '1')
    assert.equal(col('dnc_entries', 'lifted_reason'), '1')
  })
  check('138 rollback drops only the two columns and keeps every DNC row; re-apply restores them', () => {
    q(`insert into dnc_entries (contact, channel, scope, reason, lifted_at, lifted_reason) values ('+15125550000','sms','internal','inbound STOP (t)', now(), 'START (t)')`)
    runRollback('138_dnc_lift_marker.sql')
    assert.equal(col('dnc_entries', 'lifted_at'), '0')
    assert.equal(col('dnc_entries', 'lifted_reason'), '0')
    assert.equal(q(`select count(*) from dnc_entries where contact='+15125550000'`), '1', 'a rollback must never delete a DNC row')
    reapply('138_dnc_lift_marker.sql')
    assert.equal(col('dnc_entries', 'lifted_at'), '1')
  })
  // ── The runbook's combined §4 rollback (the block the owner runs), then re-apply 138, 140, 141 ──
  check('runbook §4 rollback removes 141, 140 and 138 in one transaction; re-applying all three restores them', () => {
    runSql(runbookSql('rollback:138-141'))
    assert.equal(table('automation_switches'), '0')
    assert.equal(col('dnc_entries', 'lifted_at'), '0')
    assert.equal(q(`select count(*) from schema_migrations where filename in ('138_dnc_lift_marker.sql','140_automation_switches.sql','141_engine_retry_redispatch_switch.sql')`), '0')
    for (const f of ['138_dnc_lift_marker.sql', '140_automation_switches.sql', '141_engine_retry_redispatch_switch.sql']) reapply(f)
    assert.equal(col('dnc_entries', 'lifted_at'), '1')
    assert.equal(q(`select string_agg(key || '=' || mode, ',' order by key) from automation_switches`), 'callback_engine_state=off,engine_retry_redispatch=off')
  })
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop > /dev/null 2>&1`) } catch { /* ignore */ }
}
if (failures) { console.error(`\n✗ ${failures} rollback assertion(s) FAILED.`); process.exit(1) }
console.log('\nAutomation-audit migration rollbacks proven (137, 138, 139, 140, 141).')
