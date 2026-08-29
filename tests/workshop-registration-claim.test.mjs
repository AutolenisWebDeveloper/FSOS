// Batch 2 proof — atomic registration claim (migration 128) against a REAL Postgres:
// WS-003 (case-insensitive duplicate guard, partial so cancelled rows don't block a
// re-registration), WS-004/WS-060 (per-SESSION capacity, locked count+insert in one
// transaction — the last seat cannot double-fill), D-7 (guests consume in-person seats
// only; virtual nullable = unbounded), WS-037 (past sessions refused), WS-048 (a session
// must belong to the workshop), plus migration-on-dirty-data safety (re-applying 128 over
// seeded duplicates collapses them instead of failing the index build).
// Run: node tests/workshop-registration-claim.test.mjs   (rls suite; needs root Postgres)
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { guardInfraOrExit, bootCluster, stopCluster, q, sh } from './helpers/workshop-guarantee-common.mjs'

const PGBIN = guardInfraOrExit()
let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }
const j = (s) => JSON.parse(s)

const W = 'cccc1111-1111-1111-1111-111111111111'
const S = 'cccc2222-2222-2222-2222-222222222222'
const S_PAST = 'cccc3333-3333-3333-3333-333333333333'
const W2 = 'cccc4444-4444-4444-4444-444444444444'
const S_OTHER = 'cccc5555-5555-5555-5555-555555555555'
const DB = 'fsos_claim'
const claim = (args) => j(q(DB, `select workshop_claim_registration(${args})`))

console.log('Registration claim — real Postgres (migration 128)')
let exitCode = 0
try {
  bootCluster(PGBIN)
  q('postgres', `create database ${DB} template fsos_wbase`)
  q(DB, `
    insert into workshops (workshop_id, title, topic, scheduled_at, status)
      values ('${W}', 'Cap Test', 'retirement', now() + interval '2 days', 'published'),
             ('${W2}', 'Other Workshop', 'retirement', now() + interval '3 days', 'published');
    insert into workshop_sessions (id, workshop_id, starts_at, delivery_mode, timezone, capacity_in_person) values
      ('${S}', '${W}', now() + interval '2 days', 'hybrid', 'America/Chicago', 2),
      ('${S_PAST}', '${W}', now() - interval '1 hour', 'in_person', 'America/Chicago', null),
      ('${S_OTHER}', '${W2}', now() + interval '3 days', 'in_person', 'America/Chicago', 10);`)

  const base = (email, extra) => `'${W}','${S}','T','${email}',null,${extra}`

  ok('a party of 2 (1 + 1 guest) claims 2 of the 2 in-person seats',
    claim(`${base('a@x.com', `'in_person','{}','t','tk1',1`)}`).ok === true)
  const full = claim(`${base('b@x.com', `'in_person','{}','t','tk2',0`)}`)
  ok('the next in-person claim is refused full with seats_left 0', full.ok === false && full.reason === 'full' && full.seats_left === 0)
  const dup = claim(`${base('A@X.COM', `'virtual','{}','t','tk3',0`)}`)
  ok('the same email (any case, any mode) is a DUPLICATE, never a second row', dup.ok === false && dup.reason === 'duplicate')
  ok('a virtual registrant still claims (nullable virtual capacity = unbounded; no chair consumed)',
    claim(`${base('c@x.com', `'virtual','{}','t','tk4',0`)}`).ok === true)
  const mism = claim(`'${W}','${S_OTHER}','T','d@x.com',null,'in_person','{}','t','tk5',0`)
  ok("another workshop's session id is refused (WS-048)", mism.ok === false && mism.reason === 'session_mismatch')
  const past = claim(`'${W}','${S_PAST}','T','e@x.com',null,'in_person','{}','t','tk6',0`)
  ok('a started session is refused (WS-037)', past.ok === false && past.reason === 'past_event')
  ok('stored emails are normalized to lowercase inside the claim',
    q(DB, `select count(*)::int from workshop_registrations where workshop_id='${W}' and email = lower(email)`) === q(DB, `select count(*)::int from workshop_registrations where workshop_id='${W}'`))

  // A cancelled registration frees the identity: re-registering the same email succeeds.
  q(DB, `update workshop_registrations set status='cancelled' where workshop_id='${W}' and email='a@x.com'`)
  ok('after a cancel, the same email can register again (partial unique index)',
    claim(`${base('a@x.com', `'virtual','{}','t','tk7',0`)}`).ok === true)

  // ── The last-seat RACE: T1 claims inside an open transaction and holds the session
  //    lock; T2 must WAIT on the lock, then see the committed seat and be refused. ──
  q(DB, `delete from workshop_registrations where session_id='${S}'`)
  claim(`${base('p1@x.com', `'in_person','{}','t','tkp1',0`)}`)
  const SQLDIR = '/tmp/fsos-workshop-guarantee-sql'
  const { writeFileSync } = await import('node:fs')
  writeFileSync(`${SQLDIR}/race-t1.sql`,
    `begin;\nselect workshop_claim_registration('${W}','${S}','R1','r1@x.com',null,'in_person','{}','t','tkr1',0);\nselect pg_sleep(1.5);\ncommit;\n`)
  writeFileSync(`${SQLDIR}/race-t2.sql`,
    `select workshop_claim_registration('${W}','${S}','R2','r2@x.com',null,'in_person','{}','t','tkr2',0);\n`)
  sh(`chmod 644 ${SQLDIR}/race-t1.sql ${SQLDIR}/race-t2.sql`)
  sh(`bash -c 'PSQL="runuser -u postgres -- psql -h /tmp/fsos-workshop-guarantee-log -p 55490 -U postgres -d ${DB} -t -A -q"; ($PSQL -f ${SQLDIR}/race-t1.sql > /tmp/wclaim-t1.out 2>&1) & sleep 0.4; $PSQL -f ${SQLDIR}/race-t2.sql > /tmp/wclaim-t2.out 2>&1; wait'`)
  const t1 = execSync('cat /tmp/wclaim-t1.out', { encoding: 'utf8' })
  const t2 = execSync('cat /tmp/wclaim-t2.out', { encoding: 'utf8' })
  ok('overlapping last-seat claims: the lock-holder wins…', /"ok": true/.test(t1), t1)
  ok('…and the waiter is refused full after the lock clears (exactly one winner)', /"reason": "full"/.test(t2), t2)
  ok('final active count equals the capacity exactly',
    q(DB, `select count(*)::int from workshop_registrations where session_id='${S}' and status not in ('cancelled','ffs_referred')`) === '2')

  // ── Migration-on-dirty-data safety: drop the index, seed duplicates, re-apply 128. ──
  q(DB, `drop index idx_wreg_active_email`)
  q(DB, `insert into workshop_registrations (workshop_id, session_id, name, email, status, registered_at) values
          ('${W}','${S}','Dup One','dup@x.com','registered', now() - interval '2 days'),
          ('${W}','${S}','Dup Two','DUP@x.com','registered', now() - interval '1 day')`)
  sh(`runuser -u postgres -- psql -h /tmp/fsos-workshop-guarantee-log -p 55490 -U postgres -d ${DB} -v ON_ERROR_STOP=1 -q -f /tmp/fsos-workshop-guarantee-sql/mig/128_workshop_registration_integrity.sql`)
  ok('re-applying 128 over seeded duplicates keeps the EARLIEST active and cancels the later',
    q(DB, `select status from workshop_registrations where lower(email)='dup@x.com' order by registered_at`) === 'registered\ncancelled')
  ok('and the unique index is back',
    q(DB, `select count(*)::int from pg_indexes where indexname='idx_wreg_active_email'`) === '1')

  console.log(`\n${passed} checks passed.`)
} catch (err) {
  exitCode = 1
  console.error(`\n✗ FAILED after ${passed} checks: ${err.message}`)
} finally {
  stopCluster(PGBIN)
}
process.exit(exitCode)
