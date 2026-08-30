// DUAL-PATH COVERAGE (owner-directed re-audit, items 2–4).
//
// The WS-042 defect had a specific shape: a function with an explicit path and a fallback
// path, a test that only ever drove the fallback, and a bug sitting in the explicit half.
// A route can reject correctly and still write to the wrong row on success. This file
// closes the three remaining instances of that shape found in the audit, by EXECUTING both
// halves of each fork and asserting which one ran — not by reading source.
//
//   • addWalkIn        — explicit session_id vs. the earliest-session fallback, AND the
//                        consent-evidence writes the walk-in sheet is supposed to leave
//                        behind (no test called this function at all).
//   • resolveSessionId — the registration's own session vs. the workshop's earliest,
//                        plus reconcileAttendance's written===0 && skipped>0 branch,
//                        which is keyed on that resolution failing.
//   • cancel_ack       — the null-session branch of sendCancelAcknowledgment and what the
//                        merge tokens render when there is no session to render from.
//
// DB-free: the harness's scripted PostgREST-chain fake. Schema-level truth (constraints,
// RLS, triggers) is proven against real Postgres in the rls suite.
// Run: node tests/workshop-dual-path-coverage.test.mjs
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, fakeDb, installDb, makeReq, auditCalls } from './helpers/workshop-harness.mjs'

let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

const W = 'w-1'
const S_EXPLICIT = 'sess-explicit'
const S_FALLBACK = 'sess-fallback'
const META = { ip: '203.0.113.9', userAgent: 'Kiosk/1.0', disclosureText: 'Educational event — no product recommendation.', disclosureVersion: 'email v2' }

const server = await bundle('src/lib/workshops/server.ts')

// ── addWalkIn ───────────────────────────────────────────────────────────────────
console.log('addWalkIn — the EXPLICIT session (no test has ever called this function)')
{
  const db = fakeDb({
    workshop_registrations: [{ reg_id: 'wi-1' }, null],
    workshop_consent_events: [null, null],
    workshop_attendance: [null],
  })
  const res = await server.addWalkIn(db, W, {
    name: 'Dana Walk-In', email: 'Dana@Example.COM', phone: '+12145550111',
    session_id: S_EXPLICIT, marketing_opt_in: true,
  }, META)
  ok('the walk-in is created against the NAMED session', res.session_id === S_EXPLICIT && res.registration_id === 'wi-1')
  ok('no session lookup ran at all — the explicit id short-circuits the fallback',
    !db.calls.some((c) => c.table === 'workshop_sessions'),
    JSON.stringify(db.calls.map((c) => c.table)))
  const ins = db.calls.find((c) => c.table === 'workshop_registrations' && c.method === 'insert')
  ok('…the row carries that session id', !!ins && ins.payload.session_id === S_EXPLICIT)
  ok('…flagged is_walk_in with lead_source=walk-in (a walk-in is never mistaken for a web signup)',
    !!ins && ins.payload.is_walk_in === true && ins.payload.lead_source === 'walk-in')
  ok('…email normalized to lowercase on write (§12, same rule as the public claim)',
    !!ins && ins.payload.email === 'dana@example.com')
  ok('…and the consent capture is STAMPED, which the mig-132 marketing constraint requires',
    !!ins && ins.payload.marketing_opt_in === true &&
      typeof ins.payload.consent_captured_at === 'string' &&
      /walk-in/.test(String(ins.payload.consent_form_version)))

  const evidence = db.calls.filter((c) => c.table === 'workshop_consent_events' && c.method === 'insert')
  ok('TWO evidence inserts: the reminder basis, then the marketing box', evidence.length === 2)
  const basis = evidence[0].payload
  ok('the reminder-basis rows cover both reachable channels', Array.isArray(basis) && basis.length === 2 &&
    basis.map((r) => r.channel).sort().join(',') === 'email,sms')
  ok('…the SMS row carries the SMS disclosure, the email row the shown disclosure + basis',
    /reminder|text|msg/i.test(String(basis.find((r) => r.channel === 'sms').disclosure_text)) &&
      /no product recommendation/.test(String(basis.find((r) => r.channel === 'email').disclosure_text)),
    JSON.stringify(basis))
  ok('…with the kiosk IP and user agent recorded as the capture context',
    basis.every((r) => r.ip_address === META.ip && r.user_agent === META.userAgent))
  const marketing = evidence[1].payload
  ok('the marketing rows are SEPARATE and labelled marketing (never merged into the basis)',
    Array.isArray(marketing) && marketing.length === 2 &&
      marketing.every((r) => /marketing/.test(String(r.disclosure_version))))
  const att = db.calls.find((c) => c.table === 'workshop_attendance' && c.method === 'upsert')
  ok('attendance is written as attended/checkin against the named session',
    !!att && att.payload.session_id === S_EXPLICIT && att.payload.status === 'attended' && att.payload.capture_method === 'checkin')
}

console.log('addWalkIn — the FALLBACK session, and the consent DEFAULT')
{
  const db = fakeDb({
    workshop_sessions: [{ id: S_FALLBACK }],
    workshop_registrations: [{ reg_id: 'wi-2' }, null],
    workshop_consent_events: [null],
    workshop_attendance: [null],
  })
  const res = await server.addWalkIn(db, W, { name: 'Pat Nobox', email: 'pat@example.com' }, META)
  ok('with no session named, the workshop\'s earliest session is resolved', res.session_id === S_FALLBACK)
  ok('…and the lookup was scoped to this workshop',
    db.calls.some((c) => c.table === 'workshop_sessions' && c.filters.some(([op, k, v]) => op === 'eq' && k === 'workshop_id' && v === W)))
  const ins = db.calls.find((c) => c.table === 'workshop_registrations' && c.method === 'insert')
  ok('MARKETING CONSENT DEFAULTS FALSE for a registration not created through the public form',
    !!ins && ins.payload.marketing_opt_in === false)
  ok('…and the capture fields are still stamped, so the row satisfies wreg_marketing_capture_chk either way',
    !!ins && typeof ins.payload.consent_captured_at === 'string' && !!ins.payload.consent_form_version)
  const evidence = db.calls.filter((c) => c.table === 'workshop_consent_events' && c.method === 'insert')
  ok('exactly ONE evidence insert — no marketing rows without the box', evidence.length === 1)
  ok('…and only the email channel, because no phone was given',
    evidence[0].payload.length === 1 && evidence[0].payload[0].channel === 'email')
}

console.log('addWalkIn — the degenerate paths')
{
  // No contact details at all: a paper sign-in with just a name. There is nothing to
  // consent for, so no evidence row may be fabricated.
  const db = fakeDb({
    workshop_sessions: [{ id: S_FALLBACK }],
    workshop_registrations: [{ reg_id: 'wi-3' }, null],
    workshop_attendance: [null],
  })
  await server.addWalkIn(db, W, { name: 'Anonymous Attendee' }, META)
  ok('a name-only walk-in writes NO consent evidence (nothing was captured, nothing is claimed)',
    !db.calls.some((c) => c.table === 'workshop_consent_events'))

  // The workshop has no session at all: the registration still lands, attendance cannot.
  const db2 = fakeDb({
    workshop_sessions: [null],
    workshop_registrations: [{ reg_id: 'wi-4' }],
    workshop_consent_events: [null],
  })
  const res2 = await server.addWalkIn(db2, W, { name: 'Sessionless', email: 's@example.com' }, META)
  ok('with no resolvable session the walk-in is still recorded…', res2.registration_id === 'wi-4' && res2.session_id === null)
  ok('…and NO attendance row is invented against a session that does not exist',
    !db2.calls.some((c) => c.table === 'workshop_attendance'))

  // A failed insert must throw, not return a half-made result.
  const db3 = fakeDb({
    workshop_sessions: [{ id: S_FALLBACK }],
    workshop_registrations: [{ __throw: 'insert exploded' }],
  })
  let threw = false
  try { await server.addWalkIn(db3, W, { name: 'Boom', email: 'b@example.com' }, META) } catch { threw = true }
  ok('a failed registration insert THROWS rather than reporting a walk-in that does not exist', threw)
}

// ── resolveSessionId, both halves ───────────────────────────────────────────────
console.log('resolveSessionId — the registration\'s OWN session vs. the workshop fallback')
{
  const db = fakeDb({
    workshop_registrations: [{ reg_id: 'r-a', workshop_id: W, session_id: S_EXPLICIT }, null],
    workshop_attendance: [null, null],
  })
  const res = await server.checkInByToken(db, W, 'tok-a')
  ok('a registration WITH a session checks into that session', res.ok === true && res.session_id === S_EXPLICIT)
  ok('…without querying workshop_sessions at all (the explicit half, never previously driven)',
    !db.calls.some((c) => c.table === 'workshop_sessions'))

  const db2 = fakeDb({
    workshop_registrations: [{ reg_id: 'r-b', workshop_id: W, session_id: null }, null],
    workshop_sessions: [{ id: S_FALLBACK }],
    workshop_attendance: [null, null],
  })
  const res2 = await server.checkInByToken(db2, W, 'tok-b')
  ok('a registration with NO session falls back to the workshop\'s earliest', res2.ok === true && res2.session_id === S_FALLBACK)
  const att = db2.calls.find((c) => c.table === 'workshop_attendance' && c.method === 'upsert')
  ok('…and attendance is keyed to the RESOLVED session', !!att && att.payload.session_id === S_FALLBACK)

  const db3 = fakeDb({
    workshop_registrations: [{ reg_id: 'r-c', workshop_id: W, session_id: null }],
    workshop_sessions: [null],
  })
  const res3 = await server.checkInByToken(db3, W, 'tok-c')
  ok('unresolvable → a clean 409, never an attendance row without a session',
    res3.ok === false && res3.status === 409 && !db3.calls.some((c) => c.table === 'workshop_attendance'))
}

console.log('reconcileAttendance — the written===0 && skipped>0 branch keyed on that resolution')
{
  // Registrations that belong to a DIFFERENT workshop are filtered out by the query, so
  // the map is empty and every entry is skipped. Nothing may be written.
  const db = fakeDb({ workshop_registrations: [[]] })
  const out = await server.reconcileAttendance(db, W, [
    { registration_id: 'r-x', status: 'attended' },
    { registration_id: 'r-y', status: 'no_show' },
  ])
  ok('entries whose registrations are not in this workshop are all skipped',
    out.written === 0 && out.skipped === 2, JSON.stringify(out))
  ok('…with no attendance write attempted', !db.calls.some((c) => c.table === 'workshop_attendance'))

  // Found, but the session cannot be resolved: same outcome, a different cause.
  const db2 = fakeDb({
    workshop_registrations: [[{ reg_id: 'r-z', workshop_id: W, session_id: null }]],
    workshop_sessions: [null],
  })
  const out2 = await server.reconcileAttendance(db2, W, [{ registration_id: 'r-z', status: 'attended' }])
  ok('a found registration with no resolvable session is skipped, not written blind',
    out2.written === 0 && out2.skipped === 1 && !db2.calls.some((c) => c.table === 'workshop_attendance'), JSON.stringify(out2))

  // And the positive control: a resolvable one IS written, so the skip above is a real
  // branch decision rather than a function that never writes.
  const db3 = fakeDb({
    workshop_registrations: [[{ reg_id: 'r-w', workshop_id: W, session_id: S_EXPLICIT }], null],
    workshop_attendance: [null, null],
  })
  const out3 = await server.reconcileAttendance(db3, W, [{ registration_id: 'r-w', status: 'attended' }])
  ok('POSITIVE CONTROL: a resolvable entry is written (skipped>0 above is a decision, not paralysis)',
    out3.written === 1 && out3.skipped === 0, JSON.stringify(out3))
}

// ── cancel_ack with no session ──────────────────────────────────────────────────
console.log('sendCancelAcknowledgment — the NULL-session branch and what it renders')
globalThis.__gateCalls = []
const stubDir = mkdtempSync(join(tmpdir(), 'fsos-dualpath-gate-'))
process.on('exit', () => { try { rmSync(stubDir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const gateStub = join(stubDir, 'send-stub.mjs')
writeFileSync(gateStub, `
export async function sendMessage(ctx) {
  globalThis.__gateCalls.push(ctx)
  return { sent: true, gate: { blockedStep: null }, messageId: 'cm-cancel', reason: null }
}
export async function isTemplateApproved() { return true }
`)
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test'
const engine = await bundle('src/lib/workshops/comms-engine.ts', { aliases: { '@/lib/comms/send': gateStub } })

const CFG_ROW = { id: 'global', enabled: true, sender_physical_address: '123 Main St, McKinney TX 75070' }
const TPL_CANCEL = {
  id: 'wmt-cancel', comm_template_id: 'tpl-cancel', status: 'approved', active: true, disclosure_config_id: null,
  subject: 'Your registration for {{workshop_title}} is cancelled',
  body: 'Hi {{name}} — your seat for {{workshop_title}} on {{starts_local}} at {{venue}} is released. Manage: {{cancel_url}}',
}
const REG_NO_SESSION = {
  reg_id: 'reg-ns', name: 'Robin Cancel', email: 'robin@example.com', phone: null,
  consent_channels: ['email'], join_url: null, join_token: 'tok-cancel-1',
  registered_at: '2026-08-01T00:00:00Z', marketing_opt_in: false, status: 'cancelled',
  workshop_id: W, session_id: null, lead_converted_at: null, referral_id: null,
}
{
  globalThis.__gateCalls = []
  const db = fakeDb({
    workshop_comms_config: [CFG_ROW],
    workshop_registrations: [REG_NO_SESSION],
    workshops: [{ workshop_id: W, title: 'Retirement Readiness 101', slug: 'rr-101', is_security: false, status: 'cancelled' }],
    workshop_message_log: [null, { id: 'log-ns' }],
    workshop_message_templates: [TPL_CANCEL],
  })
  const status = await engine.sendCancelAcknowledgment(db, 'reg-ns')
  ok('a registration with NO session still gets its cancellation acknowledgment', status === 'sent')
  ok('…and the session lookup was SKIPPED entirely (the null branch, never previously driven)',
    !db.calls.some((c) => c.table === 'workshop_sessions'),
    JSON.stringify(db.calls.map((c) => c.table)))
  const ctx = globalThis.__gateCalls[0]
  ok('the gate was invoked exactly once', globalThis.__gateCalls.length === 1)
  ok('NO merge token is left unresolved in the body — a registrant never sees {{starts_local}}',
    !!ctx && !/\{\{[a-z_]+\}\}/.test(ctx.body), ctx?.body)
  ok('…nor in the subject', !!ctx && !/\{\{[a-z_]+\}\}/.test(String(ctx.subject)), String(ctx?.subject))
  ok('the absent date and venue render EMPTY — no fabricated time, no guessed venue',
    !!ctx && / on  at  is released/.test(ctx.body), ctx?.body)
  ok('the registrant\'s own cancel link is still built from the join token (it needs no session)',
    !!ctx && ctx.body.includes('https://app.example.test/workshops/cancel?token=tok-cancel-1'), ctx?.body)
  ok('the workshop title still renders (the null session does not blank unrelated tokens)',
    !!ctx && /Retirement Readiness 101/.test(ctx.body))
}
{
  // POSITIVE CONTROL: the same template WITH a session renders the date and venue, so
  // the emptiness above is the null branch and not a broken renderer.
  globalThis.__gateCalls = []
  const db = fakeDb({
    workshop_comms_config: [CFG_ROW],
    workshop_registrations: [{ ...REG_NO_SESSION, session_id: 'sess-real' }],
    workshops: [{ workshop_id: W, title: 'Retirement Readiness 101', slug: 'rr-101', is_security: false, status: 'cancelled' }],
    workshop_sessions: [{ id: 'sess-real', workshop_id: W, starts_at: '2026-09-01T18:00:00Z', ends_at: null, timezone: 'America/Chicago', delivery_mode: 'in_person', venue_name: 'Community Hall', venue_address: null, status: 'scheduled', cadence_generation: 0 }],
    workshop_message_log: [null, { id: 'log-rs' }],
    workshop_message_templates: [TPL_CANCEL],
  })
  const status = await engine.sendCancelAcknowledgment(db, 'reg-rs')
  const ctx = globalThis.__gateCalls[0]
  ok('POSITIVE CONTROL: with a session, the SAME template renders the venue and a local date',
    status === 'sent' && !!ctx && /Community Hall/.test(ctx.body) && !/ on  at /.test(ctx.body), ctx?.body)
  ok('…and the session WAS looked up on this path', db.calls.some((c) => c.table === 'workshop_sessions'))
}


// ── Migration 134: the LOSING writer treats a unique violation as SUCCESS ───────
console.log('\nThe opportunities de-dupe race — the convert route, EXECUTED')
{
  // idx_opportunities_live_referral decides the race at the DB (proven against real
  // Postgres by overlapping transactions in tests/opportunity-referral-race.test.mjs).
  // Proven HERE is the caller half: the route that LOSES must enrich the winner, not 500.
  const stubDir2 = mkdtempSync(join(tmpdir(), 'fsos-convert-stub-'))
  process.on('exit', () => { try { rmSync(stubDir2, { recursive: true, force: true }) } catch { /* best-effort */ } })
  const authStub = join(stubDir2, 'auth.mjs')
  writeFileSync(authStub, `
const session = { userId: 'u-1', roles: ['fsa'], email: 'fsa@test.example' }
export async function requireApiRole() { return { ok: true, session } }
export function requirePermission() { return null }
export function actorOf() { return 'u-1' }
export function hasSecuritiesScope() { return true }
`)
  const consentStub = join(stubDir2, 'consent.mjs')
  writeFileSync(consentStub, `export async function recordConsentChange() { return { ok: true } }`)
  const convert = await bundle('src/app/api/referrals/[id]/convert/route.ts', {
    aliases: { '@/lib/auth/api': authStub, '@/lib/comms/consent-events': consentStub },
  })

  const REFID = 'rrrr1111-1111-1111-1111-111111111111'
  const WINNER = 'oooo2222-2222-2222-2222-222222222222'
  const UNIQUE_VIOLATION = { __error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_opportunities_live_referral"' } }
  const props2 = { params: Promise.resolve({ id: REFID }) }
  const body = {
    primary_name: 'Racer Household',
    member_full_name: 'Dana Racer',
    member_email: 'dana@example.com',
    engagement: 'direct',
    idempotency_key: 'convert-race-key-0001',
  }

  const script = (oppScript) => ({
    referrals: [{ id: REFID, referring_agency_id: null, status: 'received', first_name: 'Dana', last_name: 'Racer', email: 'dana@example.com', phone: null, is_security: false, dob: null }, null],
    household_members: [null],
    households: [{ id: 'hhhh3333-3333-3333-3333-333333333333' }],
    consents: [null],
    opportunities: oppScript,
    agency_partnerships: [null],
  })

  // LOSING run: the lookup finds nothing, the insert hits the index, the re-read finds
  // the winner, and the route enriches it.
  globalThis.__wsAuditCalls = []
  const dbLose = installDb(fakeDb(script([null, UNIQUE_VIOLATION, { id: WINNER, household_id: null }, null])))
  dbLose.rpc = async () => ({ data: 'mmmm4444-4444-4444-4444-444444444444', error: null })
  const resLose = await convert.POST(makeReq('/api/x', { method: 'POST', body }), props2)
  installDb(null)
  const loseBody = await resLose.clone().json().catch(() => ({}))
  ok('losing the insert race is NOT a 500 — the route succeeds (201)', resLose.status === 201,
    `status=${resLose.status} body=${JSON.stringify(loseBody)}`)
  ok('…and returns the WINNER\'s opportunity id, not a second row',
    loseBody.opportunity_id === WINNER, JSON.stringify(loseBody))
  const upd = dbLose.calls.find((c) => c.table === 'opportunities' && c.method === 'update')
  ok('…it ENRICHES the winning row rather than inserting a second',
    !!upd && upd.filters.some(([op, k, v]) => op === 'eq' && k === 'id' && v === WINNER))
  ok('…and audits the lost race explicitly, so the pipeline record says what happened',
    auditCalls().some((a) => a.entity === 'opportunity' && a.diff?.lost_insert_race === true),
    JSON.stringify(auditCalls().map((a) => a.diff)))
  ok('…exactly ONE opportunity insert was attempted (no retry loop, no second row)',
    dbLose.calls.filter((c) => c.table === 'opportunities' && c.method === 'insert').length === 1)

  // POSITIVE CONTROL: an uncontended conversion still inserts normally.
  globalThis.__wsAuditCalls = []
  const dbWin = installDb(fakeDb(script([null, { id: 'oooo5555-5555-5555-5555-555555555555' }, null])))
  dbWin.rpc = async () => ({ data: 'mmmm4444-4444-4444-4444-444444444444', error: null })
  const resWin = await convert.POST(makeReq('/api/x', { method: 'POST', body }), props2)
  installDb(null)
  ok('POSITIVE CONTROL: an uncontended conversion inserts and returns 201',
    resWin.status === 201 && dbWin.calls.some((c) => c.table === 'opportunities' && c.method === 'insert'),
    `status=${resWin.status}`)
  ok('…and does NOT claim a lost race', !auditCalls().some((a) => a.diff?.lost_insert_race === true))

  // A NON-23505 insert failure must still surface as a 500.
  const dbReal = installDb(fakeDb(script([null, { __error: { code: '23503', message: 'foreign key violation' } }])))
  dbReal.rpc = async () => ({ data: 'mmmm4444-4444-4444-4444-444444444444', error: null })
  const resReal = await convert.POST(makeReq('/api/x', { method: 'POST', body }), props2)
  installDb(null)
  ok('a REAL insert failure (not 23505) is still a 500 — the guard did not swallow it',
    resReal.status === 500, `status=${resReal.status}`)
}

console.log(`\n${passed} checks passed.`)
