// Batch 4 GUARANTEE — lifecycle + change comms against the REAL engine and REAL
// Postgres (migration 130 live):
//   • a material reschedule bumps the session's cadence generation, the change pass
//     notifies exactly the affected registrants ONCE per generation (re-ticks absorb;
//     a later registrant who saw the new details is excluded), and the pre-event
//     reminder claims RE-ARM at the new generation while one-time kinds do not;
//   • an agency cancellation (workshop → cancelled) cascades to the session and turns
//     into exactly one event_cancelled per active registrant, after which the reminder
//     pass goes silent for that session;
//   • a registrant cancel terminates the cadence durably (no later tick resurrects it)
//     and its acknowledgment rides the same claimed path (absorbing);
//   • the DB-level lifecycle guards hold: publish gate on INSERT, terminal states with
//     the approval-voiding reopen, the kind CHECK, and the 4-part claim key.
// Run: node tests/workshop-lifecycle.test.mjs   (rls suite; needs root Postgres)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  guardInfraOrExit, bootCluster, stopCluster, freezeClock, installFetchStub,
  installProviderEnv, resetProviderCalls, providerCalls, freshWorkshopDb,
  q, IDS, buildWorkshopBundle,
} from './helpers/workshop-guarantee-common.mjs'

const PGBIN = guardInfraOrExit()
let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

/** Message-log rows for ONE registration, oldest-first, as plain objects. */
const rowsFor = (db, regId, kind) => JSON.parse(q(db,
  `select coalesce(jsonb_agg(t order by (t->>'created_at'), t->>'channel'), '[]'::jsonb)::text
     from (select to_jsonb(l) as t from workshop_message_log l
            where registration_id = '${regId}'${kind ? ` and kind = '${kind}'` : ''}) s`) || '[]')
/** Expect a psql statement to FAIL; returns the error text. */
const mustRaise = (db, sql) => { try { q(db, sql) } catch (e) { return String(e.stderr || e.message) } return null }

const REG2 = 'bbbb1111-2222-3333-4444-555555555555'

console.log('GUARANTEE: lifecycle changes — re-arm, change notices, cancellation (real engine, real Postgres)')
let exitCode = 0
try {
  bootCluster(PGBIN)
  installProviderEnv()
  installFetchStub()
  // Frozen at 16:00Z = 11:00 America/Chicago (inside the 9–20 recipient-local window
  // for the +1214 NPA), 20h before the session start → reminder_1d is due.
  freezeClock('2026-08-06T16:00:00.000Z')

  const { name } = freshWorkshopDb({
    startsAtIso: '2026-08-07T12:00:00Z',
    endsAtIso: '2026-08-07T13:00:00Z',
    timezone: 'America/Chicago',
    phone: '+12145550188',
    registeredIso: '2026-08-05T12:00:00Z',
    kinds: ['reminder_1d', 'change_reschedule', 'event_cancelled', 'cancel_ack'],
  })

  const require = createRequire(import.meta.url)
  const engine = require(await buildWorkshopBundle())

  // ── 1. Baseline: reminder_1d goes out once at generation 1 and re-ticks absorb. ──
  resetProviderCalls()
  await engine.runReminderPass()
  await engine.runReminderPass()
  let r1d = rowsFor(name, IDS.reg, 'reminder_1d')
  ok('reminder_1d sent once per channel at generation 1 (re-tick absorbed)',
    r1d.length === 2 && r1d.every((r) => r.status === 'sent' && r.cadence_generation === 1),
    JSON.stringify(r1d))
  ok('exactly 2 provider calls for it (1 email + 1 SMS)',
    providerCalls.resend.length === 1 && providerCalls.twilio.length === 1)

  // ── 2. RESCHEDULE (route-mirror write): +2h, generation 2, pending change recorded.
  //       A second registrant signs up AFTER the change — they saw the new time. ──
  q(name, `update workshop_sessions
             set starts_at='2026-08-07T14:00:00Z', ends_at='2026-08-07T15:00:00Z',
                 cadence_generation=2, change_kind='change_reschedule',
                 change_recorded_at='2026-08-06T15:30:00Z'
           where id='${IDS.session}'`)
  q(name, `insert into workshop_registrations (reg_id, workshop_id, session_id, name, email, phone, consent_channels, status, registered_at)
             values ('${REG2}', '${IDS.workshop}', '${IDS.session}', 'Late Larry', 'larry@example.com', '+12145550199', '{email,sms}', 'registered', '2026-08-06T15:45:00Z')`)

  resetProviderCalls()
  await engine.runChangePass()
  const chg1 = rowsFor(name, IDS.reg, 'change_reschedule')
  ok('change pass: the pre-change registrant gets change_reschedule on BOTH channels at generation 2',
    chg1.length === 2 && chg1.every((r) => r.status === 'sent' && r.cadence_generation === 2),
    JSON.stringify(chg1))
  ok('change pass: the post-change registrant is EXCLUDED (they registered under the new time)',
    rowsFor(name, REG2, 'change_reschedule').length === 0)
  ok('change pass: 2 provider calls exactly',
    providerCalls.resend.length === 1 && providerCalls.twilio.length === 1)

  await engine.runChangePass()
  ok('change pass re-tick absorbs (still 2 rows, no third send)',
    rowsFor(name, IDS.reg, 'change_reschedule').length === 2)

  // ── 3. The reminder claims RE-ARM at generation 2; one-time kinds do NOT. ──
  resetProviderCalls()
  await engine.runReminderPass()
  r1d = rowsFor(name, IDS.reg, 'reminder_1d')
  ok('reminder_1d RE-ARMED: fresh generation-2 claims sent (4 rows total: 2×gen1 + 2×gen2)',
    r1d.length === 4 && r1d.filter((r) => r.cadence_generation === 2 && r.status === 'sent').length === 2,
    JSON.stringify(r1d))
  const conf = rowsFor(name, IDS.reg, 'confirmation')
  ok('confirmation stays ONE-TIME: still generation-0 rows only, never re-armed by the reschedule',
    conf.length > 0 && conf.every((r) => r.cadence_generation === 0),
    JSON.stringify(conf))

  // ── 4. A SECOND reschedule (generation 3, recorded AFTER Larry registered) now
  //       includes him — his registration predates THIS change. ──
  q(name, `update workshop_sessions
             set starts_at='2026-08-07T15:00:00Z', cadence_generation=3,
                 change_kind='change_reschedule', change_recorded_at='2026-08-06T15:55:00Z'
           where id='${IDS.session}'`)
  await engine.runChangePass()
  ok('second reschedule notifies the original registrant again (generation 3)',
    rowsFor(name, IDS.reg, 'change_reschedule').filter((r) => r.cadence_generation === 3 && r.status === 'sent').length === 2)
  ok('…and NOW includes the late registrant (this change postdates his signup)',
    rowsFor(name, REG2, 'change_reschedule').filter((r) => r.cadence_generation === 3 && r.status === 'sent').length === 2)

  // ── 5. Registrant cancel: durable cadence termination + absorbing acknowledgment. ──
  q(name, `update workshop_registrations set status='cancelled', cancelled_at='2026-08-06T16:00:00Z' where reg_id='${REG2}'`)
  const resendBefore = providerCalls.resend.length
  const ackFirst = await engine.sendCancelAcknowledgment(globalThis.__FSOS_DB__, REG2)
  const ackAgain = await engine.sendCancelAcknowledgment(globalThis.__FSOS_DB__, REG2)
  const ackRows = rowsFor(name, REG2, 'cancel_ack')
  // The second call reports the absorbed slot's terminal status ('sent') — the claim
  // proof is ONE row, ONE provider dispatch, generation 0.
  ok('cancel_ack rides the claimed path: one send at generation 0, second attempt absorbed (no second dispatch)',
    ackFirst === 'sent' && ackAgain === 'sent' && ackRows.length === 1 &&
      ackRows[0].status === 'sent' && ackRows[0].cadence_generation === 0 &&
      providerCalls.resend.length === resendBefore + 1,
    `first=${ackFirst} again=${ackAgain} resendΔ=${providerCalls.resend.length - resendBefore} rows=${JSON.stringify(ackRows)}`)

  const preCancelCount = rowsFor(name, REG2).length
  await engine.runReminderPass()
  await engine.runChangePass()
  ok('a cancelled registration is DURABLY terminated: later ticks add zero rows for it',
    rowsFor(name, REG2).length === preCancelCount)

  // ── 6. Agency cancel: workshop → cancelled cascades to the session; exactly one
  //       event_cancelled per ACTIVE registrant; the reminder pass goes silent. ──
  q(name, `update workshops set status='cancelled' where workshop_id='${IDS.workshop}'`)
  ok('the DB cascade marked the scheduled session cancelled (route-independent, WS-008)',
    q(name, `select status from workshop_sessions where id='${IDS.session}'`) === 'cancelled')

  resetProviderCalls()
  await engine.runChangePass()
  await engine.runChangePass()
  const ec1 = rowsFor(name, IDS.reg, 'event_cancelled')
  ok('event_cancelled to the active registrant on BOTH channels, once (re-tick absorbed)',
    ec1.length === 2 && ec1.every((r) => r.status === 'sent'),
    JSON.stringify(ec1))
  ok('the cancelled registrant gets NO cancellation notice (already out)',
    rowsFor(name, REG2, 'event_cancelled').length === 0)

  const preSilence = rowsFor(name, IDS.reg).length
  await engine.runReminderPass()
  ok('the reminder pass is silent for the cancelled session (no new rows)',
    rowsFor(name, IDS.reg).length === preSilence)

  // ── 7. DB-level lifecycle guards (migration 130). ──
  ok('a direct INSERT of a published workshop RAISES (publish gate now guards INSERT)',
    /cannot publish/.test(mustRaise(name, `insert into workshops (title, topic, scheduled_at, status)
        values ('Bypass', 'retirement', now(), 'published')`) ?? ''))
  ok('cancelled → published RAISES (terminal state, WS-070b)',
    /terminal/.test(mustRaise(name, `update workshops set status='published' where workshop_id='${IDS.workshop}'`) ?? ''))
  q(name, `update workshops set status='draft' where workshop_id='${IDS.workshop}'`)
  ok('the reopen to draft is allowed and VOIDS the compliance approval pointer',
    q(name, `select (status = 'draft' and compliance_approval_ref is null)::text from workshops where workshop_id='${IDS.workshop}'`) === 'true')
  ok('republishing after reopen without a FRESH approval RAISES (the gate re-runs for real)',
    /cannot publish/.test(mustRaise(name, `update workshops set status='published' where workshop_id='${IDS.workshop}'`) ?? ''))
  ok('an unknown message kind RAISES (WS-066 closed vocabulary)',
    /wml_kind_chk/.test(mustRaise(name, `insert into workshop_message_log (registration_id, channel, kind, status)
        values ('${IDS.reg}', 'sms', 'reminder_2h', 'sending')`) ?? ''))
  ok('a duplicate claim at the SAME generation RAISES (4-part key holds)',
    /idx_wml_claim/.test(mustRaise(name, `insert into workshop_message_log (registration_id, channel, kind, status, cadence_generation)
        values ('${IDS.reg}', 'email', 'reminder_1d', 'sending', 2)`) ?? ''))

  // ── 8. Sanity: total provider traffic matches the sends asserted above. ──
  ok('no unaccounted provider traffic in the cancellation phase',
    providerCalls.resend.length + providerCalls.twilio.length === 2, // event_cancelled email+sms only
    `resend=${providerCalls.resend.length} twilio=${providerCalls.twilio.length}`)

  console.log(`\n${passed} checks passed.`)
} catch (err) {
  exitCode = 1
  console.error(`\n✗ FAILED after ${passed} checks: ${err.message}`)
} finally {
  stopCluster(PGBIN)
}
process.exit(exitCode)
