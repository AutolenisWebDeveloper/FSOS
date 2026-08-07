// PROOF — comm_templates copy history is captured, tamper-evident, and scoped (ADR-037,
// migration 105). Stands up an ephemeral Postgres, applies the real migrations, and asserts:
//   • an UPDATE that changes body snapshots the OLD row (version + body + approval state),
//     so "which copy was approved and in force until when" is answerable after the fact;
//   • an UPDATE that does NOT change copy writes NO snapshot — approval transitions belong
//     to audit_log, and duplicating them here would fork a second audit subsystem;
//   • a body_text-only change DOES snapshot (ADR-025 makes body + body_text one artifact);
//   • the trigger fires for a caller holding NO insert privilege on the history table —
//     the proof that SECURITY DEFINER is load-bearing and not decoration;
//   • a write that asserts no actor records NULL rather than carrying a stale name forward;
//   • the history is append-only: UPDATE, DELETE and TRUNCATE all raise, even for the table
//     owner — TRUNCATE being the vector audit_log carried until migration 077;
//   • a template carrying history cannot be deleted (on delete restrict) — deletion must
//     not be a way to erase the record of what the copy used to say;
//   • RLS hides the history from a client, while an internal role can read it.
// Requires a local Postgres + the `postgres` OS user. Skips cleanly (never falsely passes).
// Run: node tests/comm-template-version-history.test.mjs
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
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    console.error('The template-history proof cannot silently skip in CI — provision Postgres.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  process.exit(0)
}

const D = '/tmp/fsos-ctv-test'
const L = '/tmp/fsos-ctv-log'
const P = '55456'
const H = L
const UID = '11111111-1111-1111-1111-111111111111'
const TPL = 'aaaaaaaa-0000-4000-8000-000000000001'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -f ${path}`)
}
// Run a statement; return true iff it raised an error. Used to prove a guard fires.
function psqlErrors(sql) {
  try {
    sh(`runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(sql)}`)
    return false
  } catch {
    return true
  }
}
function psqlQuery(sql) {
  const raw = sh(
    `runuser -u postgres -- psql -h ${H} -p ${P} -U postgres -d fsos_test -v ON_ERROR_STOP=1 -t -A -c ${JSON.stringify(sql)}`,
  )
  // A leading "set role" emits a "SET" command tag; the SELECT value is last.
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}
// Write-then-run, so a statement containing $-quoting or `set role` is never mangled by
// the shell (the same reason the firewall proof prefers -f over -c for writes).
function psqlRun(name, sql) {
  const f = `${L}/${name}.sql`
  writeFileSync(f, sql.endsWith('\n') ? sql : `${sql}\n`)
  psqlFile(f)
}

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('comm_templates version history — snapshot, append-only, scope (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${H} -p ${P} -U postgres fsos_test`)

  // Supabase-provided bits: auth.uid() pinned to a test user; the auth roles.
  writeFileSync(
    `${L}/setup.sql`,
    `create schema if not exists auth;\n` +
      `create or replace function auth.uid() returns uuid language sql stable as 'select ''${UID}''::uuid';\n` +
      `do 'begin if not exists (select from pg_roles where rolname=''authenticated'') then create role authenticated; end if; ` +
      `if not exists (select from pg_roles where rolname=''anon'') then create role anon; end if; ` +
      `if not exists (select from pg_roles where rolname=''service_role'') then create role service_role; end if; end';\n`,
  )
  psqlFile(`${L}/setup.sql`)

  psqlFile('supabase/migrations/009_aggregate_root_core.sql')  // comm_templates
  psqlFile('supabase/migrations/010_rls_guardrails.sql')       // is_super()/has_role(), RLS
  psqlFile('supabase/migrations/011_p0_softdelete_views_dob.sql')     // deleted_at, needed by 012
  psqlFile('supabase/migrations/012_p1_reviews_comms_commission.sql') // approved_at/updated_by/…
  psqlFile('supabase/migrations/061_comm_template_render.sql') // body_text/render_sha
  psqlFile('supabase/migrations/105_comm_template_version_history.sql') // under test

  // A template that has been through the normal lifecycle: authored, then approved.
  // `tmpl_editor` is a deliberately UNPRIVILEGED writer — it may edit comm_templates but
  // holds no insert on comm_template_versions, which is what makes the definer proof real.
  writeFileSync(
    `${L}/seed.sql`,
    `insert into comm_templates(id, name, channel, category, body, body_text, approval_status, version, approved_by, updated_by) values ` +
      `('${TPL}','WB Email #1','email','pipeline_winback','V1 BODY','V1 TEXT','approved',1,'compliance-user','author-user');\n` +
      `do 'begin if not exists (select from pg_roles where rolname=''tmpl_editor'') then create role tmpl_editor; end if; end';\n` +
      `grant select, update on comm_templates to tmpl_editor;\n` +
      `drop policy if exists tmpl_editor_rw on comm_templates;\n` +
      `create policy tmpl_editor_rw on comm_templates for all to tmpl_editor using (true) with check (true);\n` +
      `insert into user_roles(user_id, role) values ('${UID}','client');\n`,
  )
  psqlFile(`${L}/seed.sql`)

  // ── 1. A copy change snapshots the OLD row ────────────────────────────────
  // Mirrors the real PATCH write: body replaced, version bumped, approval reset — all in
  // ONE update, so the snapshot must record the PRIOR body at its PRIOR approval state.
  psqlRun('edit1', `update comm_templates set body='V2 BODY', version=2, approval_status='draft', approved_by=null, updated_by='editor-two' where id='${TPL}';`)

  t('a body change writes exactly one snapshot', () => {
    assert.equal(psqlQuery(`select count(*) from comm_template_versions where template_id='${TPL}';`), '1')
  })

  t('the snapshot holds the SUPERSEDED body, version and approval state (not the replacement)', () => {
    const row = psqlQuery(
      `select version || '|' || body || '|' || body_text || '|' || approval_status || '|' || coalesce(approved_by,'-') ` +
        `from comm_template_versions where template_id='${TPL}';`,
    )
    assert.equal(row, '1|V1 BODY|V1 TEXT|approved|compliance-user')
  })

  t('the snapshot attributes the change to the superseding writer', () => {
    assert.equal(psqlQuery(`select superseded_by from comm_template_versions where template_id='${TPL}';`), 'editor-two')
  })

  // ── 2. A non-copy change writes NOTHING ───────────────────────────────────
  t('an approval transition alone writes no snapshot (that is audit_log\'s job)', () => {
    psqlRun('approve', `update comm_templates set approval_status='approved', approved_by='compliance-user', name='WB Email #1 (renamed)' where id='${TPL}';`)
    assert.equal(psqlQuery(`select count(*) from comm_template_versions where template_id='${TPL}';`), '1')
  })

  // ── 3. body_text is part of the approved artifact (ADR-025) ───────────────
  t('a body_text-only change DOES snapshot (plaintext is half the approved artifact)', () => {
    psqlRun('edit2', `update comm_templates set body_text='V3 TEXT', version=3 where id='${TPL}';`)
    assert.equal(psqlQuery(`select count(*) from comm_template_versions where template_id='${TPL}';`), '2')
    assert.equal(
      psqlQuery(`select body_text from comm_template_versions where template_id='${TPL}' order by version desc limit 1;`),
      'V1 TEXT',
    )
  })

  // ── 4. SECURITY DEFINER is load-bearing ───────────────────────────────────
  // An unprivileged editor cannot write the history table directly...
  t('an unprivileged editor is DENIED a direct insert into the history', () => {
    const denied = psqlErrors(
      `set role tmpl_editor; insert into comm_template_versions(template_id, version, name, channel, body, approval_status) ` +
        `values ('${TPL}', 99, 'forged', 'email', 'FORGED', 'approved');`,
    )
    assert.equal(denied, true, 'a non-privileged role must not be able to forge a history row')
  })

  // ...yet its ordinary edit still produces a snapshot, because the trigger runs as definer.
  t('...yet that same editor\'s copy change still snapshots (definer path works)', () => {
    psqlRun('edit3', `set role tmpl_editor;\nupdate comm_templates set body='V4 BODY', version=4 where id='${TPL}';`)
    assert.equal(psqlQuery(`select count(*) from comm_template_versions where template_id='${TPL}';`), '3')
    assert.equal(
      psqlQuery(`select body from comm_template_versions where template_id='${TPL}' order by version desc limit 1;`),
      'V2 BODY',
    )
  })

  // This edit set no updated_by, so the actor must be NULL. Note updated_by is a PERSISTED
  // column: it still reads 'editor-two' from the earlier edit, so a bare new.updated_by would
  // credit that prior editor for a write they had nothing to do with. current_user is no help
  // either — inside a SECURITY DEFINER body it is the function owner. Absent beats wrong.
  t('an unattributed write records NO actor rather than a stale one', () => {
    assert.equal(
      psqlQuery(`select coalesce(superseded_by,'<null>') from comm_template_versions where template_id='${TPL}' order by version desc limit 1;`),
      '<null>',
    )
  })

  // ── 5. Append-only, tamper-evident ────────────────────────────────────────
  t('UPDATE on the history raises, even as the table owner', () => {
    assert.equal(psqlErrors(`update comm_template_versions set body='REWRITTEN' where template_id='${TPL}';`), true)
  })

  t('DELETE from the history raises, even as the table owner', () => {
    assert.equal(psqlErrors(`delete from comm_template_versions where template_id='${TPL}';`), true)
  })

  // The vector audit_log carried until migration 077: TRUNCATE bypasses both the DELETE
  // revoke and the row-level trigger, so it needs its own statement-level guard.
  t('TRUNCATE on the history raises (the mig-077 vector, closed here at birth)', () => {
    assert.equal(psqlErrors('truncate comm_template_versions;'), true)
    assert.equal(psqlQuery(`select count(*) from comm_template_versions where template_id='${TPL}';`), '3')
  })

  // ── 6. Deleting the template cannot erase its history ─────────────────────
  t('a template carrying history cannot be deleted (on delete restrict)', () => {
    assert.equal(psqlErrors(`delete from comm_templates where id='${TPL}';`), true)
    assert.equal(psqlQuery(`select count(*) from comm_template_versions where template_id='${TPL}';`), '3')
  })

  // ── 7. Scope: internal ops data, never client-visible ─────────────────────
  t('a client sees ZERO history rows (RLS denies, not merely a missing grant)', () => {
    assert.equal(psqlQuery('set role authenticated; select count(*) from comm_template_versions;'), '0')
  })

  t('an internal role (fsa) CAN read the history — the policy is not deny-all', () => {
    psqlRun('role-fsa', `update user_roles set role='fsa' where user_id='${UID}';`)
    assert.equal(psqlQuery('set role authenticated; select count(*) from comm_template_versions;'), '3')
  })

  console.log(`\nAll ${passed} assertions passed.`)
} finally {
  try { sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -m immediate stop > /dev/null 2>&1`) } catch { /* ignore */ }
  try { sh(`rm -rf ${D} ${L}`) } catch { /* ignore */ }
}
