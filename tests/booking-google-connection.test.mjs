// Native booking — Google Calendar connection DB proof (Slice 7). Stands up an ephemeral
// Postgres, applies a minimal fixture + migration 072, and proves the security-critical DB
// behavior of the calendar connection:
//   • pgcrypto round-trip: the credential set via booking_calendar_set_secret decrypts back
//     ONLY with the correct key; a wrong key fails (encrypted at rest, key never in the DB),
//   • one active connection per host is enforced (partial unique indexes) — for both a named
//     host and the null "default practice host",
//   • disconnect (soft-delete + secret_enc cleared) frees the slot so a reconnect can insert.
// Requires local Postgres + `postgres` OS user; skips cleanly unless CI_REQUIRE_INFRA=1.
// Run: node tests/booking-google-connection.test.mjs
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
} catch {
  /* ignore */
}
let canRunAsPostgres = false
try {
  sh('id postgres')
  canRunAsPostgres = true
} catch {
  /* ignore */
}
if (!PGBIN || !canRunAsPostgres) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but local Postgres / postgres user is unavailable.')
    process.exit(1)
  }
  console.log('SKIP: local Postgres / postgres user unavailable — run in an environment with both.')
  process.exit(0)
}

const D = '/tmp/fsos-gcal-conn'
const L = '/tmp/fsos-gcal-connlog'
const P = '55471'
const HOST = '22222222-2222-2222-2222-222222222222'
const KEY = 'correct-horse-battery-staple'
const SECRET = '{"access_token":"AT","refresh_token":"RT","expires_at":"2026-08-10T00:00:00.000Z"}'

function psqlFile(path) {
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -v ON_ERROR_STOP=1 -q -f ${path}`)
}
function raises(sql) {
  try {
    sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(sql)}`)
    return false
  } catch {
    return true
  }
}
function scalar(sql) {
  return sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -q -t -A -c ${JSON.stringify(sql)}`)
    .split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? ''
}

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Google Calendar connection DB proof (ephemeral Postgres)')
try {
  sh(`rm -rf ${D} ${L} && mkdir -p ${D} ${L} && chown postgres:postgres ${D} ${L}`)
  sh(`runuser -u postgres -- ${PGBIN}/initdb -D ${D} -U postgres --auth=trust > ${L}/init.log 2>&1`)
  sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} -o "-p ${P} -k ${L}" -l ${L}/run.log start > ${L}/start.log 2>&1`)
  sh('sleep 2')
  sh(`runuser -u postgres -- ${PGBIN}/createdb -h ${L} -p ${P} -U postgres rtest`)

  // Minimal fixture: only the shared updated_at trigger function (the migration creates pgcrypto).
  writeFileSync(
    `${L}/fixture.sql`,
    `create or replace function update_updated_at() returns trigger language plpgsql as 'begin new.updated_at = now(); return new; end';\n`,
  )
  psqlFile(`${L}/fixture.sql`)
  psqlFile('supabase/migrations/072_booking_calendar_connection.sql')

  // Seed one connection for the named host, encrypt a credential at rest.
  const id = scalar(
    `insert into booking_calendar_connections (host_user_id, status) values ('${HOST}','not_configured') returning id;`,
  )
  assert.match(id, /[0-9a-f-]{36}/)
  sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -q -c ${JSON.stringify(
    `select booking_calendar_set_secret('${id}', ${quote(SECRET)}, ${quote(KEY)});`,
  )}`)

  t('the stored credential is not plaintext in the column (encrypted at rest)', () => {
    const enc = scalar(`select encode(secret_enc,'hex') from booking_calendar_connections where id='${id}';`)
    assert.ok(enc.length > 0)
    // The hex-encoded ciphertext must not literally contain the access token bytes.
    assert.doesNotMatch(Buffer.from(enc, 'hex').toString('latin1'), /access_token/)
  })

  t('decrypts back to the exact plaintext ONLY with the correct key', () => {
    const back = scalar(`select booking_calendar_secret('${id}', ${quote(KEY)});`)
    assert.equal(back, SECRET)
  })

  t('a wrong decryption key fails (key is never stored in the DB)', () => {
    assert.equal(raises(`select booking_calendar_secret('${id}', 'wrong-key');`), true)
  })

  t('one active connection per named host is enforced', () => {
    assert.equal(
      raises(`insert into booking_calendar_connections (host_user_id, status) values ('${HOST}','connected');`),
      true,
    )
  })

  t('one active connection for the default (null) host is enforced', () => {
    assert.equal(raises(`insert into booking_calendar_connections (host_user_id) values (null);`), false)
    assert.equal(raises(`insert into booking_calendar_connections (host_user_id) values (null);`), true)
  })

  t('disconnect (soft-delete + secret cleared) frees the slot for a reconnect', () => {
    sh(`runuser -u postgres -- psql -h ${L} -p ${P} -U postgres -d rtest -q -c ${JSON.stringify(
      `update booking_calendar_connections set deleted_at=now(), status='revoked', secret_enc=null where id='${id}';`,
    )}`)
    // Old row's secret is gone.
    assert.equal(scalar(`select secret_enc is null from booking_calendar_connections where id='${id}';`), 't')
    // A fresh active connection for the same host now inserts cleanly.
    assert.equal(
      raises(`insert into booking_calendar_connections (host_user_id, status) values ('${HOST}','connected');`),
      false,
    )
    assert.equal(
      scalar(`select count(*) from booking_calendar_connections where host_user_id='${HOST}' and deleted_at is null;`),
      '1',
    )
  })

  console.log(`\nAll ${passed} assertions passed.`)
} finally {
  try {
    sh(`runuser -u postgres -- ${PGBIN}/pg_ctl -D ${D} stop -m immediate > /dev/null 2>&1`)
  } catch {
    /* ignore */
  }
  sh(`rm -rf ${D} ${L}`)
}

function quote(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}
