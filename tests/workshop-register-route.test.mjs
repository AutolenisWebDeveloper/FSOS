// Batch 2 — the public register route EXECUTED (bundled, scripted db): guardrail ORDER
// (rate limiter counts before the honeypot fake-success — WS-061), honeypot logging
// (WS-057), the atomic-claim outcomes mapped to distinct responses (duplicate =
// already_registered STATE, full/past/cancelled/mismatch codes — WS-024), guest_count
// passthrough (D-7), and the upcoming-only session fallback. DB-free (unit suite); the
// claim itself is proven against real Postgres in workshop-registration-claim.test.mjs.
// Run: node tests/workshop-register-route.test.mjs
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, fakeDb, installDb, makeReq } from './helpers/workshop-harness.mjs'

let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

// The receipt rides the ONE send chokepoint; record what it hands over so the ack's
// content is assertable without a live send.
globalThis.__ackSends = []
const stubDir = mkdtempSync(join(tmpdir(), 'fsos-reg-ack-'))
process.on('exit', () => { try { rmSync(stubDir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const sendStub = join(stubDir, 'send-stub.mjs')
writeFileSync(sendStub, `
export async function sendMessage(ctx) {
  globalThis.__ackSends.push(ctx)
  return { sent: true, gate: { blockedStep: null }, messageId: 'cm-ack', reason: null }
}
export async function isTemplateApproved() { return true }
`)

const route = await bundle('src/app/api/public/workshops/register/route.ts', { aliases: { '@/lib/comms/send': sendStub } })
const W = 'dddd1111-1111-1111-1111-111111111111'
const S = 'dddd2222-2222-2222-2222-222222222222'
const PUBLISHED = { workshop_id: W, title: 'T', status: 'published', max_attendees: 50, disclosure_config_id: null }
const GOOD_BODY = { workshop_id: W, session_id: S, name: 'A', email: 'a@x.com', marketing_opt_in: false }
const req = (body, ip) => makeReq('/api/public/workshops/register', { body, headers: { 'x-forwarded-for': ip } })

// A scripted db for one full happy-path request: workshop → rpc claim → session detail.
function happyDb(claimResult) {
  const db = fakeDb({
    workshops: [PUBLISHED],
    workshop_sessions: [{ starts_at: '2026-09-01T18:00:00Z', timezone: 'America/Chicago', venue_name: 'Hall', venue_address: null }],
  })
  db.rpc = async (fn, args) => { db.rpcCalls = db.rpcCalls ?? []; db.rpcCalls.push({ fn, args }); return { data: claimResult, error: null } }
  return db
}

console.log('Guardrail order — the rate limiter counts BEFORE the honeypot (WS-061)')
{
  installDb(null) // neither path below may reach the db
  let last = null
  for (let i = 0; i < 6; i++) {
    last = await route.POST(req({ company: 'bot corp', ...GOOD_BODY }, '198.51.100.9'))
    if (i < 5) ok(`honeypot hit ${i + 1} gets the fake success (and burns a rate slot)`, last.status === 200)
  }
  ok('the 6th rapid hit from the same IP is 429 — honeypot traffic was COUNTED', last.status === 429)
}

console.log('Claim outcome mapping (WS-024 / D-7)')
{
  const db = happyDb({ ok: false, reason: 'duplicate' })
  installDb(db)
  const res = await route.POST(req(GOOD_BODY, '198.51.100.10'))
  const body = await res.json()
  installDb(null)
  ok('duplicate → 200 with already_registered STATE (never an error, never a second row)',
    res.status === 200 && body.ok === true && body.already_registered === true)

  const dbFull = happyDb({ ok: false, reason: 'full', seats_left: 0 })
  installDb(dbFull)
  const resFull = await route.POST(req(GOOD_BODY, '198.51.100.11'))
  const bodyFull = await resFull.json()
  installDb(null)
  ok('full → 409 with code full + seats_left', resFull.status === 409 && bodyFull.code === 'full' && bodyFull.seats_left === 0)

  const dbPast = happyDb({ ok: false, reason: 'past_event' })
  installDb(dbPast)
  const resPast = await route.POST(req(GOOD_BODY, '198.51.100.12'))
  installDb(null)
  ok('past_event → 409 (WS-037 surfaced to the form)', resPast.status === 409)

  const dbMism = happyDb({ ok: false, reason: 'session_mismatch' })
  installDb(dbMism)
  const resMism = await route.POST(req(GOOD_BODY, '198.51.100.13'))
  installDb(null)
  ok('session_mismatch → 422 (WS-048 surfaced)', resMism.status === 422)
}

console.log('Claim inputs (D-7 guest passthrough + normalization by the function)')
{
  const db = happyDb({ ok: true, reg_id: 'r-1' })
  installDb(db)
  const res = await route.POST(req({ ...GOOD_BODY, guest_count: 3, chosen_delivery: 'in_person', phone: '+12145550188', marketing_opt_in: true }, '198.51.100.14'))
  installDb(null)
  ok('a successful claim returns ok + join_token', res.status === 200 && !!(await res.json()).join_token)
  const rowUpdate = db.calls.find((c) => c.table === 'workshop_registrations' && c.method === 'update')
  ok('the consent FACTS are stamped on the registration row (opt-in + captured_at + form version)',
    !!rowUpdate && rowUpdate.payload.marketing_opt_in === true && !!rowUpdate.payload.consent_captured_at && typeof rowUpdate.payload.consent_form_version === 'string')
  const evidence = db.calls.find((c) => c.table === 'workshop_consent_events' && c.method === 'insert')
  ok('capture-time evidence rows are written (reminder basis + the marketing grant)',
    !!evidence && Array.isArray(evidence.payload) && evidence.payload.length === 4)
  const call = db.rpcCalls?.[0]
  ok('the route claims through workshop_claim_registration', call?.fn === 'workshop_claim_registration')
  ok('guest_count reaches the claim (in-person plus-ones consume seats)', call?.args?.p_guest_count === 3)
  ok('the client session id is passed for the claim to VERIFY (never trusted)', call?.args?.p_session === S)
}

console.log('Session fallback — only UPCOMING, non-cancelled sessions are considered')
{
  const db = fakeDb({
    workshops: [PUBLISHED],
    workshop_sessions: [null], // no upcoming session found
  })
  db.rpc = async () => { throw new Error('rpc must not run without a session') }
  installDb(db)
  const res = await route.POST(req({ ...GOOD_BODY, session_id: undefined }, '198.51.100.15'))
  installDb(null)
  ok('no upcoming session → 409 without attempting a claim', res.status === 409)
  const sessQuery = db.calls.find((c) => c.table === 'workshop_sessions')
  ok('the fallback query filters cancelled + past sessions',
    !!sessQuery && sessQuery.filters.some(([op, k]) => op === 'neq' && k === 'status') &&
    sessQuery.filters.some(([op, k]) => op === 'gte' && k === 'starts_at'))
}

console.log('Receipt "When" row — the venue wall clock or NOTHING (no Central guess)')
{
  // The session's timezone column is NOT NULL with a default, so an unset zone arrives as
  // '' — not null. The old `s.timezone || 'America/Chicago'` turned that into a confident
  // Central time on the one message the registrant keeps, and its catch turned a bad zone
  // into a UTC string. Both stated an hour the registrant would plan around.
  const withZone = (tz) => {
    const db = fakeDb({
      workshops: [PUBLISHED],
      workshop_sessions: [{ starts_at: '2026-09-01T18:00:00Z', timezone: tz, venue_name: 'Hall', venue_address: null, ends_at: null, ics_uid: null }],
    })
    db.rpc = async () => ({ data: { ok: true, reg_id: 'r-tz' }, error: null })
    return db
  }

  globalThis.__ackSends = []
  installDb(withZone('America/Chicago'))
  await route.POST(req(GOOD_BODY, '198.51.100.20'))
  installDb(null)
  const good = globalThis.__ackSends.find((c) => c.channel === 'email')
  ok('a resolvable zone puts the VENUE wall clock in the receipt (18:00Z Sep 1 = 1:00 PM CDT)',
    !!good && /September 1, 2026/.test(good.body) && /1:00\s?PM/.test(good.body),
    good?.body?.slice(0, 400))

  globalThis.__ackSends = []
  installDb(withZone(''))
  await route.POST(req(GOOD_BODY, '198.51.100.21'))
  installDb(null)
  const blank = globalThis.__ackSends.find((c) => c.channel === 'email')
  ok('an EMPTY zone omits the When row entirely — no Central date, no UTC string',
    !!blank && !/September 1, 2026/.test(blank.body) && !/1:00\s?PM/.test(blank.body) && !/Sep 2026 18:00:00 GMT/.test(blank.body),
    blank?.body?.slice(0, 400))
  ok('…and the receipt still SENDS with the rest of its content intact (fail closed on the field, not the message)',
    !!blank && /Hall/.test(blank.body) && /T/.test(blank.body))

  globalThis.__ackSends = []
  installDb(withZone('Not/AZone'))
  await route.POST(req(GOOD_BODY, '198.51.100.22'))
  installDb(null)
  const bogus = globalThis.__ackSends.find((c) => c.channel === 'email')
  ok('an UNKNOWN zone likewise omits the row rather than falling back to toUTCString()',
    !!bogus && !/September 1, 2026/.test(bogus.body) && !/GMT/.test(bogus.body),
    bogus?.body?.slice(0, 400))
}

console.log(`\n${passed} checks passed.`)
