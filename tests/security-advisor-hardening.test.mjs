// PROOF for migrations 142 (residual schema gaps) and 143 (security-advisor hardening), on a real
// Postgres laid out like the Supabase project: pgcrypto in `extensions`, the postgres role's
// search_path `"$user", public, extensions`, service_role with BYPASSRLS, and the platform's default
// grants (tables to anon/authenticated/service_role; functions to service_role on top of PUBLIC).
//
// WHY THIS EXISTS. The live database audit (2026-10-05) found 12 SECURITY DEFINER functions callable
// by anon, a SECURITY DEFINER view, 39 functions with a mutable search_path, and three objects the
// chain defines but production lacks. Read-only checks on 2026-10-06 also found has_role() pinned to
// search_path="" by hand, which makes every call fail (42P01) and with it every RLS policy that calls
// has_role()/is_super(). Each assertion below is one of those facts, proven on the migrated schema:
//   1. Global invariants — the regression guards. No function in public is left without a pinned
//      search_path (a later CREATE OR REPLACE without `set search_path` resets it and fails here);
//      no SECURITY DEFINER function is executable by anon or authenticated; every view runs as its
//      caller.
//   2. Behaviour — anon and signed-in users lose the server-only RPCs and the RLS helpers, so their
//      direct reads of helper-guarded tables fail closed (42501), as they effectively do in
//      production today (42P01); the contrast check shows that repairing has_role() WITHOUT the
//      revoke would open those tables to a signed-in JWT; has_role() works again for the service
//      role (negative control: production's search_path=""); the pgcrypto functions work only
//      because the pin includes `extensions` (negative control); triggers fire for a writer that
//      holds no EXECUTE on them; the service role sees the same view rows as before.
//   3. The owner's apply procedure (docs/ops/migration-runbook.md: `psql -1 -f <file> -c <ledger
//      insert>`) applied to the production state, then each file's ROLLBACK block, then re-apply.
//
// Same toolchain and skip rules as tests/migration-chain.test.mjs. Registered in the `rls` set
// (scripts/run-tests.mjs). Run: node tests/security-advisor-hardening.test.mjs
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

const M142 = '142_residual_schema_gaps.sql'
const M143 = '143_security_advisor_hardening.sql'
const D = '/tmp/fsos-advhard-data'
const L = '/tmp/fsos-advhard-log'
const P = '55476'
const DB = 'fsos_advhard'
const URL = `postgresql://postgres@/${DB}?host=${L}&port=${P}`
const psql = (args) => sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d ${DB} -v ON_ERROR_STOP=1 ${args}`)
/** Last output line of `sql` (a leading `set ...` prints a command tag first). */
// Collapsed to one line: the SQL is passed to `psql -c` inside a double-quoted shell argument.
const oneLine = (sql) => sql.replace(/\s+/g, ' ').trim()
function q(sql) {
  const lines = psql(`-t -A -c ${JSON.stringify(oneLine(sql))}`).split('\n').map((s) => s.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}
/** The error `sql` raises; fails the check if it succeeds. */
function err(sql) {
  try {
    psql(`-t -A -c ${JSON.stringify(oneLine(sql))}`)
  } catch (e) {
    return String(e.stderr || e.message)
  }
  throw new Error(`expected an error, but it succeeded: ${sql}`)
}
function runSql(sql, name) {
  writeFileSync(`${L}/${name}`, sql)
  sh(`chown postgres:postgres ${L}/${name}`)
  psql(`-q -f ${L}/${name}`)
}
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
/** The owner's procedure, verbatim from docs/ops/migration-runbook.md: lock timeout, the file and its
 * ledger row in ONE transaction. */
function ownerApply(file) {
  writeFileSync(`${L}/${file}`, readFileSync(`supabase/migrations/${file}`, 'utf8'))
  sh(`chown postgres:postgres ${L}/${file}`)
  psql(`-q -1 -c "set local lock_timeout = '5s'" -f ${L}/${file} -c ${JSON.stringify(`insert into schema_migrations (filename) values ('${file}')`)}`)
}

// Run `sql` as a signed-in user (auth.uid() reads request.jwt.claim.sub, as on Supabase).
const asUser = (uid, sql) => `set request.jwt.claim.sub = '${uid}'; set role authenticated; ${sql}`
const SUPER = '00000000-0000-4000-8000-0000000000a1'
const FSA = '00000000-0000-4000-8000-0000000000a2'

// Every function the app calls through getDb().rpc() (service role) — must stay executable by it.
const APP_RPCS = [
  'booking_calendar_secret(uuid,text)', 'booking_calendar_set_secret(uuid,text,text)',
  'calculate_case_gdc(text,text,text,text,integer,text,numeric,numeric,numeric)',
  'comm_suppression_apply(text,text,text,text,uuid,uuid[])', 'member_create(uuid,text,text,date,text,text,text)',
  'member_dob(uuid,text)', 'member_update(uuid,text,text,date,text,text,text)', 'social_channel_secret(uuid,text)',
  'social_channel_set_secret(uuid,text,text)', 'social_media_increment_usage(uuid,integer)',
  'workshop_claim_registration(uuid,uuid,text,text,text,text,text[],text,text,integer)',
]
const NOT_EXT = `not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`
const unpinned = () => q(`select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text), '') from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and ${NOT_EXT}
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)
const definerExecutableBy = (role) => q(`select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text), '') from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosecdef and ${NOT_EXT}
    and has_function_privilege('${role}', p.oid, 'EXECUTE')`)
const definerViews = () => q(`select coalesce(string_agg(relname, ', ' order by relname), '') from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'v'
    and not coalesce(reloptions::text, '') ~ 'security_invoker=(true|on)'`)
const searchPath = (sig) => q(`select coalesce((select c from unnest((select proconfig from pg_proc where oid = 'public.${sig}'::regprocedure)) c where c like 'search_path=%'), '<none>')`)
const can = (role, sig) => q(`select has_function_privilege('${role}', 'public.${sig}', 'EXECUTE')`)
const indexDef = (name) => q(`select coalesce((select indexdef from pg_indexes where schemaname = 'public' and indexname = '${name}'), '<none>')`)
const viewOptions = (name) => q(`select coalesce((select reloptions::text from pg_class where relnamespace = 'public'::regnamespace and relname = '${name}'), '<none>')`)
// Functions that call pgcrypto unqualified but whose pin omits `extensions` (where pgcrypto lives on Supabase).
const pgcryptoPinMissingExtensions = () => q(`select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text), '') from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'pgp_sym_' and ${NOT_EXT}
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c ~ '^search_path=.*\\mextensions\\M')`)
const INDEX_PENDING = /ON public\.form_submissions USING btree \(status, expires_at\)$/
const INDEX_OPRA = /ON public\.opra_cases USING btree \(created_at\) WHERE \(contacted = false\)$/
// v_contact_by_source must equal 070's aggregation computed directly over contacts.
const contactBySourceDirect = () => q(`select string_agg(s || ':' || t || ':' || o, ',' order by s) from (select coalesce(nullif(btrim(source), ''), '(unspecified)') s, count(*) t, count(*) filter (where household_id is null) o from contacts where deleted_at is null group by 1) x`)
const contactBySourceView = () => q(`set role service_role; select string_agg(source || ':' || total || ':' || orphaned, ',' order by source) from v_contact_by_source`)
// The extraction the runbook (§8 rollback) tells the owner to run: identical rules to rollbackSql().
const RB_AWK = `'/^--[[:space:]]*ROLLBACK:/ {on=1; next} on && /^--/ {sub(/^--[[:space:]]?/, ""); print; next} on {exit}'`

let failures = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓', name) } catch (e) { failures++; console.log('  ✗', name + ':', e.message) }
}

console.log('Security-advisor hardening (142, 143) — chain, invariants, behaviour, owner apply, rollback')
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
  // Platform surface, laid out as on the live project (each line verified there read-only,
  // 2026-10-06): pgcrypto in `extensions`; postgres's search_path includes `extensions`;
  // service_role bypasses RLS; default grants as listed above.
  runSql(
    `create schema if not exists auth;\ncreate schema if not exists storage;\ncreate schema if not exists extensions;\n` +
      `create extension if not exists pgcrypto schema extensions;\n` +
      `alter role postgres set search_path = "$user", public, extensions;\n` +
      `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;\n` +
      `create or replace function auth.role() returns text language sql stable as 'select current_user::text';\n` +
      `create or replace function auth.jwt() returns jsonb language sql stable as 'select ''{}''::jsonb';\n` +
      `create table if not exists storage.buckets (id text primary key, name text, public boolean default false);\n` +
      `create role anon; create role authenticated; create role service_role bypassrls;\n` +
      `grant usage on schema public, auth, extensions to anon, authenticated, service_role;\n` +
      `alter default privileges in schema public grant all on tables to anon, authenticated, service_role;\n` +
      `alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;\n` +
      `alter default privileges in schema public grant execute on functions to service_role;\n`,
    'setup.sql',
  )

  // ── 0. The whole chain, through the real runner ──────────────────────────────
  check('the whole chain (including 142 and 143) applies through scripts/migrate.mjs', () => {
    const out = sh(`node scripts/migrate.mjs`, { env: { ...process.env, DATABASE_URL: URL }, maxBuffer: 64 * 1024 * 1024 })
    assert.match(out, /Done\. \d+ migration\(s\) applied\./)
    assert.equal(q(`select count(*) from schema_migrations where filename in ('${M142}', '${M143}')`), '2')
  })

  // ── 1. Global invariants (regression guards) ─────────────────────────────────
  check('every function in public pins search_path (CREATE OR REPLACE without `set search_path` fails here)', () => {
    assert.equal(unpinned(), '', 'unpinned')
  })
  check('every function that calls pgcrypto pins a search_path that includes `extensions`', () => {
    assert.ok(Number(q(`select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~ 'pgp_sym_'`)) >= 6, 'expected the six pgcrypto callers')
    assert.equal(pgcryptoPinMissingExtensions(), '')
  })
  check('no SECURITY DEFINER function in public is executable by anon', () => {
    assert.equal(definerExecutableBy('anon'), '')
  })
  check('no SECURITY DEFINER function in public is executable by authenticated', () => {
    assert.equal(definerExecutableBy('authenticated'), '')
  })
  check('every view in public runs as its caller (security_invoker)', () => {
    assert.equal(definerViews(), '')
  })
  check('the service role can still execute every function the app calls via .rpc()', () => {
    for (const f of APP_RPCS) assert.equal(can('service_role', f), 't', f)
  })

  // ── 2. Behaviour ─────────────────────────────────────────────────────────────
  q(`insert into user_roles (user_id, role) values ('${SUPER}', 'super_admin'), ('${FSA}', 'fsa')`)
  const HH = q(`with i as (insert into households (primary_name) values ('Advisor Test Household') returning id) select id from i`)

  check('anon cannot call the server-only RPCs or the helpers', () => {
    assert.match(err(`set role anon; select member_dob('${HH}', 'k')`), /permission denied for function member_dob/)
    assert.match(err(`set role anon; select member_create('${HH}', 'X', null, null, null, null, 'k')`), /permission denied for function member_create/)
    assert.match(err(`set role anon; select social_channel_secret(gen_random_uuid(), 'k')`), /permission denied for function social_channel_secret/)
    assert.match(err(`set role anon; select is_super()`), /permission denied for function is_super/)
  })
  check('anon reads of a helper-guarded table fail closed (42501), not an empty set', () => {
    assert.match(err(`set role anon; select count(*) from user_roles`), /permission denied for function is_super/)
  })
  check('a signed-in user cannot call the server-only RPCs or the trigger functions', () => {
    assert.match(err(asUser(FSA, `select member_dob('${HH}', 'k')`)), /permission denied for function member_dob/)
    assert.match(err(asUser(FSA, `select social_channel_set_secret(gen_random_uuid(), 's', 'k')`)), /permission denied for function social_channel_set_secret/)
    assert.match(err(asUser(FSA, `select social_media_increment_usage(gen_random_uuid(), 1)`)), /permission denied for function social_media_increment_usage/)
    assert.match(err(asUser(FSA, `select current_user_roles()`)), /permission denied for function current_user_roles/)
  })
  check("a signed-in user's direct reads of helper-guarded tables fail closed (42501), even a super_admin's", () => {
    assert.match(err(asUser(SUPER, 'select count(*) from user_roles')), /permission denied for function is_super/)
    assert.match(err(asUser(FSA, 'select count(*) from contacts')), /permission denied for function is_super/)
    assert.match(err(asUser(SUPER, 'select has_role(\'super_admin\')')), /permission denied for function has_role/)
  })
  check('contrast: repairing has_role() WITHOUT the revoke would open user_roles to a signed-in JWT', () => {
    // Session ends with the transaction open, so the grant is rolled back on disconnect.
    assert.equal(q(`begin; grant execute on function is_super(), has_role(text) to authenticated; ${asUser(SUPER, 'select count(*) from user_roles')}`), '2')
    assert.match(err(asUser(SUPER, 'select count(*) from user_roles')), /permission denied for function is_super/, 'the contrast grant leaked')
  })
  check('has_role() / is_super() work again for the service role', () => {
    const svc = (uid, sql) => `set request.jwt.claim.sub = '${uid}'; set role service_role; ${sql}`
    assert.equal(q(svc(SUPER, `select has_role('super_admin')::text || '/' || is_super()::text`)), 'true/true')
    assert.equal(q(svc(FSA, `select has_role('fsa')::text || '/' || is_super()::text`)), 'true/false')
  })
  check("negative control: production's has_role search_path=\"\" fails with 42P01; 143's pin is the repair", () => {
    const broken = err(`begin; alter function has_role(text) set search_path = ''; set request.jwt.claim.sub = '${SUPER}'; set role service_role; select is_super()`)
    assert.match(broken, /relation "user_roles" does not exist/)
    assert.equal(searchPath('has_role(text)'), 'search_path=public, extensions, pg_temp')
  })
  check('the service role round-trips a DOB through member_create / member_dob (pgcrypto in `extensions`)', () => {
    const mid = q(`set role service_role; set search_path = public; select member_create('${HH}', 'Pat Example', 'self', '1980-01-02', null, null, 'test-key')`)
    assert.equal(q(`set role service_role; set search_path = public; select member_dob('${mid}', 'test-key')`), '1980-01-02')
  })
  check('negative control: a pin without `extensions` (or none) breaks DOB encryption on this layout', () => {
    assert.equal(q(`set search_path = public; select decrypt_dob(encrypt_dob('1990-03-04', 'k'), 'k')`), '1990-03-04')
    assert.match(err(`begin; alter function encrypt_dob(date, text) set search_path = public, pg_temp; set search_path = public; select encrypt_dob('1990-03-04', 'k'); rollback;`), /function pgp_sym_encrypt\(text, text\) does not exist/)
    assert.match(err(`begin; alter function encrypt_dob(date, text) reset search_path; set search_path = public; select encrypt_dob('1990-03-04', 'k'); rollback;`), /function pgp_sym_encrypt\(text, text\) does not exist/)
  })
  check('triggers still fire for a writer that holds no EXECUTE on the trigger functions', () => {
    q(`create role trigger_writer bypassrls; grant usage on schema public to trigger_writer; grant select, insert, update on comm_templates, life_campaigns to trigger_writer`)
    assert.equal(can('trigger_writer', 'comm_template_snapshot_version()'), 'f')
    assert.equal(can('trigger_writer', 'sync_engine_campaign_registry()'), 'f')
    const tid = q(`set role trigger_writer; with i as (insert into comm_templates (name, channel, body) values ('advisor-test', 'email', 'v1') returning id) select id from i`)
    q(`set role trigger_writer; update comm_templates set body = 'v2' where id = '${tid}'`)
    assert.ok(Number(q(`select count(*) from comm_template_versions where template_id = '${tid}'`)) >= 1, 'no version snapshot')
    const cid = q(`set role trigger_writer; with i as (insert into life_campaigns (name) values ('Advisor Test Campaign') returning id) select id from i`)
    assert.equal(q(`select category from comm_campaigns where id = '${cid}'`), 'engine_registry')
  })
  check('comm_sendable_assets: the service role sees exactly what the owner sees; anon no longer reads it', () => {
    assert.ok(Number(q(`select count(*) from comm_sendable_assets`)) > 0, 'empty catalog')
    assert.equal(q(`set role service_role; select count(*) from comm_sendable_assets`), q(`select count(*) from comm_sendable_assets`))
    assert.match(err(`set role anon; select count(*) from comm_sendable_assets`), /permission denied for function is_super/)
  })
  check('v_contact_by_source matches 070 (security_invoker; soft-deleted excluded; orphaned counted)', () => {
    assert.equal(viewOptions('v_contact_by_source'), '{security_invoker=true}')
    // An orphan, a linked contact and a soft-deleted one under the same source; blank and null sources.
    q(`insert into contacts (full_name, source, household_id, deleted_at) values
       ('A', 'advisor_test_src', null, null), ('E', 'advisor_test_src', '${HH}', null),
       ('D', 'advisor_test_src', null, now()), ('B', ' ', null, null), ('C', null, null, null)`)
    const direct = contactBySourceDirect()
    assert.match(direct, /advisor_test_src:2:1/)
    assert.match(direct, /\(unspecified\):\d+/)
    assert.equal(contactBySourceView(), direct)
  })
  check("the runbook's rollback extraction yields exactly each file's ROLLBACK block", () => {
    for (const f of [M142, M143]) {
      assert.equal(sh(`awk ${RB_AWK} supabase/migrations/${f}`).trim(), rollbackSql(f), f)
    }
  })

  // ── 3. Owner apply on the production state, rollback, re-apply ──────────────
  // Recreate production's pre-142/143 state (live, read-only 2026-10-06): the three objects
  // absent, the 12 functions executable via PUBLIC, has_role at search_path="", the view
  // definer-rights, neither file in the ledger.
  check("143 ROLLBACK restores production's exact prior grants, settings and view mode", () => {
    runSql(rollbackSql(M143), 'rb143.sql')
    assert.equal(can('anon', 'member_dob(uuid,text)'), 't')
    assert.equal(can('anon', 'is_super()'), 't')
    assert.equal(can('authenticated', 'is_super()'), 't')
    assert.equal(can('authenticated', 'social_channel_secret(uuid,text)'), 't')
    assert.equal(searchPath('is_super()'), '<none>')
    assert.equal(searchPath('score_opra(uuid)'), 'search_path=public')
    // has_role goes back to production's search_path="", so the restored grants re-open nothing:
    // a signed-in read still fails, as it does in production today.
    assert.equal(searchPath('has_role(text)'), 'search_path=""')
    assert.match(err(asUser(SUPER, 'select count(*) from user_roles')), /relation "user_roles" does not exist/)
    assert.equal(viewOptions('comm_sendable_assets'), '<none>')
    assert.equal(q(`set role anon; select (count(*) > 0)::text from comm_sendable_assets`), 'true', 'the definer view leaked to anon before 143')
  })
  check('142 ROLLBACK removes both indexes and the view', () => {
    runSql(rollbackSql(M142), 'rb142.sql')
    assert.equal(indexDef('idx_form_submissions_pending'), '<none>')
    assert.equal(indexDef('idx_opra_uncontacted'), '<none>')
    assert.equal(viewOptions('v_contact_by_source'), '<none>')
  })
  check("the owner's one-transaction procedure applies 142 then 143 onto production's state", () => {
    q(`delete from schema_migrations where filename in ('${M142}', '${M143}')`)
    ownerApply(M142)
    ownerApply(M143)
    assert.equal(q(`select count(*) from schema_migrations where filename in ('${M142}', '${M143}')`), '2')
    assert.equal(unpinned(), '')
    assert.equal(definerExecutableBy('anon'), '')
    assert.equal(definerExecutableBy('authenticated'), '')
    assert.equal(definerViews(), '')
    assert.equal(q(`set request.jwt.claim.sub = '${SUPER}'; set role service_role; select is_super()`), 't', 'has_role not repaired')
    assert.match(err(asUser(SUPER, 'select count(*) from user_roles')), /permission denied for function is_super/)
    // 142 itself (not 001) recreates both indexes and the view on production's state.
    assert.match(indexDef('idx_form_submissions_pending'), INDEX_PENDING)
    assert.match(indexDef('idx_opra_uncontacted'), INDEX_OPRA)
    assert.equal(viewOptions('v_contact_by_source'), '{security_invoker=true}')
    assert.equal(contactBySourceView(), contactBySourceDirect())
    assert.match(contactBySourceView(), /advisor_test_src:2:1/)
    assert.equal(pgcryptoPinMissingExtensions(), '')
  })
  check('re-recording an applied file fails loudly and changes nothing (no `on conflict do nothing`)', () => {
    assert.throws(() => ownerApply(M143))
    assert.equal(q(`select count(*) from schema_migrations where filename = '${M143}'`), '1')
  })
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop > /dev/null 2>&1`) } catch { /* ignore */ }
}
if (failures) { console.error(`\n✗ ${failures} security-advisor hardening assertion(s) FAILED.`); process.exit(1) }
console.log('\nSecurity-advisor hardening proven (142, 143): invariants, behaviour, owner apply, rollback.')
