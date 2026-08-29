// Batch 2 — the public register route EXECUTED (bundled, scripted db): guardrail ORDER
// (rate limiter counts before the honeypot fake-success — WS-061), honeypot logging
// (WS-057), the atomic-claim outcomes mapped to distinct responses (duplicate =
// already_registered STATE, full/past/cancelled/mismatch codes — WS-024), guest_count
// passthrough (D-7), and the upcoming-only session fallback. DB-free (unit suite); the
// claim itself is proven against real Postgres in workshop-registration-claim.test.mjs.
// Run: node tests/workshop-register-route.test.mjs
import assert from 'node:assert/strict'
import { bundle, fakeDb, installDb, makeReq } from './helpers/workshop-harness.mjs'

let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

const route = await bundle('src/app/api/public/workshops/register/route.ts')
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

console.log(`\n${passed} checks passed.`)
