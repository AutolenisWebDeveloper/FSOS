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
  ok('the engine produces NO confirmation rows at all (D-8: the instant ack is the confirmation of record)',
    rowsFor(name, IDS.reg, 'confirmation').length === 0)

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

  // ── 9. Batch 5 — D-1(b) cadence: day-of-AM (wall-clock) + 3d, both mode-correct. ──
  // Session TODAY at 18:00Z (1:00 PM CDT); frozen now = 11:00 AM CDT ⇒ past the 9 AM
  // venue fire-time and before start. Registered Aug 3 ⇒ 3d (fireAt Aug 3 18:00Z) due.
  console.log('D-1(b) cadence — day-of-AM + 3d')
  const A = freshWorkshopDb({
    startsAtIso: '2026-08-06T18:00:00Z',
    endsAtIso: '2026-08-06T19:00:00Z',
    timezone: 'America/Chicago',
    phone: '+12145550188',
    registeredIso: '2026-08-03T12:00:00Z',
    kinds: ['reminder_day_of', 'reminder_3d'],
  })
  resetProviderCalls()
  await engine.runReminderPass()
  const dayOf = rowsFor(A.name, IDS.reg, 'reminder_day_of')
  ok('day-of-AM fires after 9:00 venue-local, as SMS ONLY (no email row)',
    dayOf.length === 1 && dayOf[0].channel === 'sms' && dayOf[0].status === 'sent',
    JSON.stringify(dayOf))
  const r3d = rowsFor(A.name, IDS.reg, 'reminder_3d')
  ok('reminder_3d rides email + SMS (D-1(b) matrix)',
    r3d.length === 2 && r3d.every((r) => r.status === 'sent'), JSON.stringify(r3d))
  ok('and still ZERO confirmation rows on a fresh cadence (D-8)',
    rowsFor(A.name, IDS.reg, 'confirmation').length === 0)

  // ── 10. Batch 5 — WS-071: reminder_starting is VIRTUAL/HYBRID only. ──
  console.log('WS-071 — starting SMS mode gate')
  const REGB = 'bbbb3333-4444-5555-6666-777777777777'
  const SESSB = 'bbbb4444-5555-6666-7777-888888888888'
  const B = freshWorkshopDb({
    startsAtIso: '2026-08-06T15:55:00Z', // started 5 min before the frozen now (grace window)
    endsAtIso: '2026-08-06T17:00:00Z',
    timezone: 'America/Chicago',
    phone: '+12145550188',
    registeredIso: '2026-08-06T15:00:00Z', // after every offset fire-time → only 'starting' can fire
    kinds: ['reminder_starting'],
    extraSql: `
      update workshop_sessions set delivery_mode='virtual' where id='${IDS.session}';
      insert into workshop_sessions (id, workshop_id, starts_at, ends_at, delivery_mode, timezone, venue_name, status)
        values ('${SESSB}', '${IDS.workshop}', '2026-08-06T15:55:00Z', '2026-08-06T17:00:00Z', 'in_person', 'America/Chicago', 'Hall B', 'scheduled');
      insert into workshop_registrations (reg_id, workshop_id, session_id, name, email, phone, consent_channels, status, registered_at)
        values ('${REGB}', '${IDS.workshop}', '${SESSB}', 'Walk In Wanda', 'wanda@example.com', '+12145550166', '{email,sms}', 'registered', '2026-08-06T15:00:00Z');`,
  })
  await engine.runReminderPass()
  const startVirtual = rowsFor(B.name, IDS.reg, 'reminder_starting')
  ok('the VIRTUAL registrant gets the starting SMS',
    startVirtual.length === 1 && startVirtual[0].channel === 'sms' && startVirtual[0].status === 'sent',
    JSON.stringify(startVirtual))
  ok('the IN-PERSON registrant gets NO starting touch (WS-071 — nothing to tap)',
    rowsFor(B.name, REGB, 'reminder_starting').length === 0)

  // ── 11. Batch 5 — the T+2/3d follow-up: once-ever, marketing-gated. ──
  console.log('D-1 pairing — nurture follow-up')
  const REGC = 'bbbb5555-6666-7777-8888-999999999999'
  const REGD = 'bbbb6666-7777-8888-9999-aaaaaaaaaaaa'
  const REGE = 'bbbb7777-8888-9999-aaaa-bbbbbbbbbbbb'
  const C = freshWorkshopDb({
    startsAtIso: '2026-08-03T17:00:00Z',
    endsAtIso: '2026-08-03T18:00:00Z', // anchor + 2d = Aug 5 18:00Z < frozen now ⇒ due
    timezone: 'America/Chicago',
    phone: '+12145550188',
    registeredIso: '2026-08-01T12:00:00Z',
    kinds: ['nurture_followup'],
    extraSql: `
      -- WS-025: commercial email needs the real physical address (fixture E proves the
      -- placeholder DEFERS; this fixture supplies the address so marketing mail flows).
      insert into workshop_comms_config (id, sender_physical_address)
        values ('global', '123 Main St Suite 5, McKinney TX 75070')
        on conflict (id) do update set sender_physical_address = excluded.sender_physical_address;
      update workshop_registrations
        set nurture_segment='attended', nurtured_at='2026-08-03T21:00:00Z', marketing_opt_in=true,
            consent_captured_at='2026-08-01T12:00:00Z', consent_form_version='signup-v2-2026-08'
        where reg_id='${IDS.reg}';
      insert into workshop_registrations (reg_id, workshop_id, session_id, name, email, phone, consent_channels, status, registered_at, nurture_segment, nurtured_at, marketing_opt_in)
        values ('${REGC}', '${IDS.workshop}', '${IDS.session}', 'No Marketing Nia', 'nia@example.com', '+12145550177', '{email}', 'registered', '2026-08-01T12:00:00Z', 'attended', '2026-08-03T21:00:00Z', false);
      -- REG-D: ended session, NO attendance capture at all (WS-039 derives the no-show).
      insert into workshop_registrations (reg_id, workshop_id, session_id, name, email, phone, consent_channels, status, registered_at)
        values ('${REGD}', '${IDS.workshop}', '${IDS.session}', 'Absent Abe', 'abe@example.com', null, '{email}', 'registered', '2026-08-01T12:00:00Z');
      -- REG-E: ATTENDED + un-nurtured (the D-2 spine placement runs for real).
      insert into workshop_registrations (reg_id, workshop_id, session_id, name, email, phone, consent_channels, status, registered_at, marketing_opt_in, consent_captured_at, consent_form_version)
        values ('${REGE}', '${IDS.workshop}', '${IDS.session}', 'Present Pam', 'pam@example.com', '+12145550155', '{email,sms}', 'registered', '2026-08-01T12:00:00Z', true, '2026-08-01T12:00:00Z', 'signup-v2-2026-08');
      insert into workshop_attendance (registration_id, session_id, status, capture_method, checked_in_at)
        values ('${REGE}', '${IDS.session}', 'attended', 'checkin', '2026-08-03T17:05:00Z');`,
  })
  await engine.runNurturePass()
  await engine.runNurturePass()
  const fup = rowsFor(C.name, IDS.reg, 'nurture_followup')
  ok('the opted-in attendee gets ONE follow-up per channel at generation 0 (re-tick absorbed)',
    fup.length === 2 && fup.every((r) => r.status === 'sent' && r.cadence_generation === 0),
    JSON.stringify(fup))
  ok('the NON-opted registrant gets no follow-up at all (marketing basis is the ROW — no claim minted)',
    rowsFor(C.name, REGC, 'nurture_followup').length === 0)

  // ── WS-039 + WS-028: the un-captured registrant across TWO passes ──
  const derived = JSON.parse(q(C.name,
    `select coalesce(jsonb_agg(to_jsonb(a)), '[]')::text from workshop_attendance a where registration_id='${REGD}'`))
  ok('WS-039: the ended session DERIVED a durable no_show attendance row (capture_method derived), exactly one',
    derived.length === 1 && derived[0].status === 'no_show' && derived[0].capture_method === 'derived',
    JSON.stringify(derived))
  ok('…while the shipped segmentation is unchanged: the un-captured registrant still nurtures as registered_no_show',
    q(C.name, `select nurture_segment || '|' || coalesce(lead_score_delta::text,'-') from workshop_registrations where reg_id='${REGD}'`) === 'registered_no_show|-2')

  // ── D-2 (checkpoint ruling) + WS-028: attendance-time spine placement, once. ──
  const opp = JSON.parse(q(C.name,
    `select coalesce(jsonb_agg(to_jsonb(o)), '[]')::text
       from opportunities o
       join workshop_registrations r on r.referral_id = o.referral_id
      where r.reg_id = '${REGE}'`))
  ok('the ATTENDED registrant placed exactly ONE native-stage opportunity across two passes (claim-first, WS-028)',
    opp.length === 1 && opp[0].stage === 'prospect' && opp[0].engagement === 'direct',
    JSON.stringify(opp))
  ok("…carrying the queryable origin marker source='workshop_attendance' (district reporting segments it)",
    opp[0].source === 'workshop_attendance')
  ok('…and exactly one referral was seeded for them (guarded nurtured_at claim owns the side effects)',
    q(C.name, `select count(*)::int::text from referrals where lower(referred_email)='pam@example.com'`) === '1')

  // ── Migration 132 standing guards (pinned here so they stay proven) ──
  ok('the instant-ack gate handle sits in the FFS queue (submitted + provenance), NOT principal-approved',
    q(C.name, `select approval_status || '|' || (body like 'PROVENANCE:%')::text from comm_templates where id='eeee0000-0000-4000-8000-00000000ac01'`) === 'submitted|true')
  ok('marketing_opt_in=true WITHOUT a capture record is impossible (wreg_marketing_capture_chk)',
    /wreg_marketing_capture_chk/.test(mustRaise(C.name,
      `insert into workshop_registrations (workshop_id, name, email, marketing_opt_in) values ('${IDS.workshop}','X','x-check@example.com', true)`) ?? ''))
  ok('WS-063 REFUTED and pinned: workshop_sessions.ics_uid carries a UNIQUE constraint',
    q(C.name, `select count(*)::int::text from pg_constraint where conrelid='workshop_sessions'::regclass and contype='u' and pg_get_constraintdef(oid) like '%ics_uid%'`) === '1')

  // ── WS-025 (fixture E): placeholder address ⇒ commercial email DEFERS at PG level ──
  console.log('WS-025 — placeholder sender address holds commercial email')
  const E = freshWorkshopDb({
    startsAtIso: '2026-08-03T17:00:00Z',
    endsAtIso: '2026-08-03T18:00:00Z',
    timezone: 'America/Chicago',
    phone: '+12145550188',
    registeredIso: '2026-08-01T12:00:00Z',
    kinds: ['nurture_followup'],
    extraSql: `
      update workshop_registrations
        set nurture_segment='attended', nurtured_at='2026-08-03T21:00:00Z', marketing_opt_in=true,
            consent_captured_at='2026-08-01T12:00:00Z', consent_form_version='signup-v2-2026-08'
        where reg_id='${IDS.reg}';`,
  })
  await engine.runNurturePass()
  const eRows = rowsFor(E.name, IDS.reg, 'nurture_followup')
  const eEmail = eRows.find((r) => r.channel === 'email')
  const eSms = eRows.find((r) => r.channel === 'sms')
  ok('with the config still on the PLACEHOLDER address, the marketing EMAIL defers (CAN-SPAM fail-closed)',
    !!eEmail && eEmail.status === 'deferred' && eEmail.reason === 'sender_address_placeholder',
    JSON.stringify(eRows))
  ok('…while the SMS (no postal-address requirement) still goes out', !!eSms && eSms.status === 'sent')

  console.log(`\n${passed} checks passed.`)
} catch (err) {
  exitCode = 1
  console.error(`\n✗ FAILED after ${passed} checks: ${err.message}`)
} finally {
  stopCluster(PGBIN)
}
process.exit(exitCode)
