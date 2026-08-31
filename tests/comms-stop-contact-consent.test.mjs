// STOP / START must move the CONTACT-RESOLVABLE consent store, not just the member one.
//
// Why this exists: appointment SMS consent captured on the public booking form lands in
// comm_contact_consents, keyed by the phone — a public booker is a bare spine contact with no
// household member, so that store is the ONLY place their consent lives. The inbound keyword
// handler wrote a DNC row and a member-keyed revoke, and nothing at all to comm_contact_consents:
// the enforced suppression was correct, but the consent evidence store kept reading `granted`
// after a STOP.
//
// The START half is now load-bearing rather than cosmetic. comm_contact_consents is latest-wins,
// so once STOP appends a `revoked` row, a subsequent START that did NOT append a `granted` row
// would leave a non-member permanently blocked at the consent step even though the DNC row was
// cleared and they explicitly asked to be messaged again.
//
// Drives the REAL processInbound + the REAL conversations/keyword modules against an in-memory
// database. Only the send path, AI responder, and the event/suppression recorders are stubbed —
// none of them decide anything asserted here.
// Run: node tests/comms-stop-contact-consent.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)

const out = mkdtempSync(join(tmpdir(), 'fsos-stop-consent-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})
try {
  execSync(
    `npx tsc src/lib/comms/inbound.ts src/lib/comms/conversations.ts src/lib/comms/keywords.ts src/lib/comms/opt-out.ts ` +
      `src/lib/booking/optout-appointment-review.ts ` +
      `src/lib/site.ts --rootDir src --outDir ${out} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch {
  /* expected: unresolved '@/…' aliases */
}
if (!existsSync(join(out, 'lib/comms/inbound.js'))) {
  console.error('FATAL: inbound.js was not emitted')
  process.exit(1)
}

// ── In-memory database ───────────────────────────────────────────────────────
const PHONE = '+15125551234'
function makeState() {
  return {
    conversations: [],
    writes: [],
    // No household member: the public-booker case this test exists for.
    members: [],
    contacts: [],
    upcoming: [],
  }
}
let state = makeState()

function makeDb() {
  const from = (table) => {
    const filters = {}
    let op = 'select'
    let payload = null
    const b = {
      select: () => b,
      eq: (col, val) => {
        filters[col] = val
        return b
      },
      in: () => b,
      gt: () => b,
      ilike: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      insert: (row) => {
        op = 'insert'
        payload = row
        state.writes.push({ table, op: 'insert', row })
        if (table === 'comm_conversations') {
          const created = { id: `conv-${state.conversations.length + 1}`, unread_count: 0, ...row }
          state.conversations.push(created)
          payload = created
        }
        return b
      },
      update: (row) => {
        op = 'update'
        payload = row
        state.writes.push({ table, op: 'update', row })
        return b
      },
      upsert: (row) => {
        op = 'upsert'
        payload = row
        state.writes.push({ table, op: 'upsert', row })
        return b
      },
      delete: () => {
        op = 'delete'
        state.writes.push({ table, op: 'delete', filters: { ...filters } })
        return b
      },
      async maybeSingle() {
        // Return the whole inserted row, as `.insert(...).select(...).maybeSingle()` does —
        // getOrCreateConversation uses the returned row as the Conversation itself.
        if (op === 'insert') return { data: payload && payload.id ? payload : { id: 'row-1' }, error: null }
        if (op !== 'select') return { data: null, error: null }
        if (table === 'comm_conversations') {
          const hit = state.conversations.find(
            (c) => (!filters.channel || c.channel === filters.channel) && (!filters.contact || c.contact === filters.contact) && (!filters.id || c.id === filters.id),
          )
          return { data: hit ?? null, error: null }
        }
        return { data: null, error: null }
      },
      then: (resolve) => {
        if (table === 'household_members') return resolve({ data: state.members, error: null })
        if (table === 'contacts') return resolve({ data: state.contacts, error: null })
        if (table === 'appointments') return resolve({ data: state.upcoming, error: null })
        return resolve({ data: [], error: null })
      },
    }
    return b
  }
  return { from }
}

// ── Module hooks ─────────────────────────────────────────────────────────────
// `then` must be undefined: a thenable Proxy makes `await stub()` recurse forever instead of
// resolving, which shows up as an unsettled top-level await rather than a useful failure.
const makeStub = () =>
  new Proxy(function () {}, {
    get: (_t, prop) => (prop === '__esModule' ? true : prop === 'then' ? undefined : makeStub()),
    apply: () => makeStub(),
  })

// Real: conversations, keywords, stop-intent, reply-classification, conversation-mode, site.
// Stubbed: everything that would reach a provider, an AI model, or a store this test does not
// assert on. None of them decide the consent writes under test.
const RELATIVE_STUBS = new Set(['./send', './events', './turn-limit', './suppression-admin', './consent-events'])
const HOOKS = {
  '@/lib/supabase/client': { __esModule: true, getDb: () => db },
  '@/lib/audit/log': { __esModule: true, writeAudit: async () => ({ ok: true }) },
  '@/lib/ai/responder': { __esModule: true, draftReply: async () => null },
}
const db = makeDb()

const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (HOOKS[request]) return HOOKS[request]
  // Some modules reach the Supabase client relatively rather than through the alias.
  if (request.endsWith('/supabase/client')) return HOOKS['@/lib/supabase/client']
  if (request.endsWith('/audit/log')) return HOOKS['@/lib/audit/log']
  if (RELATIVE_STUBS.has(request)) return makeStub()
  if (request.startsWith('@/')) {
    const emitted = join(out, request.slice(2) + '.js')
    if (existsSync(emitted)) return origLoad.call(this, emitted, ...rest)
    return makeStub()
  }
  return origLoad.call(this, request, ...rest)
}

const { processInbound } = require(join(out, 'lib/comms/inbound.js'))

let passed = 0
let failed = 0
async function t(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ✓', name)
  } catch (e) {
    failed++
    console.error('  ✗', name)
    console.error('   ', e instanceof Error ? e.message : e)
  }
}

const consentWrites = () => state.writes.filter((w) => w.table === 'comm_contact_consents')
const dncWrites = (op) => state.writes.filter((w) => w.table === 'dnc_entries' && w.op === op)

console.log('STOP')
state = makeState()
const stopResult = await processInbound({ channel: 'sms', from: PHONE, body: 'STOP' })

await t('the inbound STOP is classified and applied', async () => {
  assert.equal(stopResult.intent, 'stop')
  assert.equal(stopResult.optedOut, true)
})
await t('the enforced suppression is still the DNC row', async () => {
  assert.equal(dncWrites('upsert').length, 1)
  assert.equal(dncWrites('upsert')[0].row.channel, 'sms')
})
await t('a contact-level REVOKED row is appended so the consent store matches reality', async () => {
  const rows = consentWrites()
  assert.equal(rows.length, 1, 'exactly one contact-consent write')
  assert.equal(rows[0].op, 'insert', 'consent history is append-only, never an in-place update')
  assert.equal(rows[0].row.action, 'revoked')
  assert.equal(rows[0].row.channel, 'sms')
})
await t('it is keyed the way the capture side and the gate both key it', async () => {
  // book.ts/sms-consent.ts store consentContactKey('sms', phone); the gate suffix-matches the
  // last 10 digits. A revoke stored under a different key would never win latest-wins.
  const stored = consentWrites()[0].row.contact
  assert.equal(stored, PHONE)
  assert.ok(stored.endsWith('5125551234'))
})
await t('the revoke carries evidence text and a version, as the column requires', async () => {
  const row = consentWrites()[0].row
  assert.ok(row.consent_text && row.consent_text.length > 0)
  assert.equal(row.consent_version, 'opt-out')
})

console.log('\nSTART / UNSTOP')
state = makeState()
await processInbound({ channel: 'sms', from: PHONE, body: 'STOP' })
const beforeStart = consentWrites().length
const startResult = await processInbound({ channel: 'sms', from: PHONE, body: 'START' })

await t('the inbound START is classified and applied', async () => {
  assert.equal(startResult.intent, 'start')
  assert.equal(startResult.optedIn, true)
})
await t('the DNC row is cleared', async () => {
  assert.equal(dncWrites('delete').length, 1)
})
await t('a contact-level GRANTED row is appended — without it a non-member stays blocked', async () => {
  const rows = consentWrites()
  assert.equal(rows.length, beforeStart + 1)
  const latest = rows[rows.length - 1].row
  assert.equal(latest.action, 'granted')
  assert.equal(latest.channel, 'sms')
  assert.equal(latest.contact, PHONE)
})
await t('the two writes are ordered revoked → granted, so latest-wins restores consent', async () => {
  assert.deepEqual(
    consentWrites().map((w) => w.row.action),
    ['revoked', 'granted'],
  )
})

console.log('\nCarrier-reported opt-out (Twilio ErrorCode 21610)')
// Twilio's Advanced Opt-Out absorbs STOP at the carrier, so the keyword never reaches the
// inbound webhook — the ONLY signal is 21610 on the delivery callback. The status route applies
// it through the same writer, so this asserts the classifier + the writer that route calls.
const { isCarrierOptOutCode, recordChannelOptOut } = require(join(out, 'lib/comms/opt-out.js'))

await t('only the unambiguous unsubscribe code counts as an opt-out', async () => {
  assert.equal(isCarrierOptOutCode('21610'), true)
  assert.equal(isCarrierOptOutCode(' 21610 '), true)
  // Delivery problems, NOT opt-outs — suppressing on these would unsubscribe people silently.
  for (const code of ['30007', '30003', '30004', '30005', '21211', '', null, undefined]) {
    assert.equal(isCarrierOptOutCode(code), false, `${code} must not be treated as an opt-out`)
  }
})

state = makeState()
await recordChannelOptOut({
  contact: PHONE,
  channel: 'sms',
  source: 'carrier_opt_out',
  reason: 'Twilio ErrorCode 21610',
  consentText: 'Carrier-reported opt-out (Twilio 21610)',
  memberId: null,
  householdId: null,
})
await t('a carrier opt-out lands in the same stores an inbound STOP does', async () => {
  assert.equal(dncWrites('upsert').length, 1, 'the enforced suppression')
  const rows = consentWrites()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].row.action, 'revoked')
  assert.equal(rows[0].row.contact, PHONE)
})

state = makeState()
await recordChannelOptOut({
  contact: PHONE,
  channel: 'sms',
  source: 'carrier_opt_out',
  reason: 'Twilio ErrorCode 21610',
  consentText: 'Carrier-reported opt-out (Twilio 21610)',
  memberId: 'mem-1',
  householdId: 'hh-1',
})
await t('for a household member it also revokes the channel AND cascades every scoped purpose', async () => {
  const consents = state.writes.filter((w) => w.table === 'consents')
  assert.equal(consents.length, 1)
  assert.equal(consents[0].row.status, 'revoked')
  const purposes = state.writes.filter((w) => w.table === 'comm_consent_purposes')
  assert.equal(purposes.length, 1, 'a scoped APPOINTMENT_REMINDERS grant must not survive an opt-out')
  assert.equal(purposes[0].row.status, 'revoked')
})

console.log('\nA STOP keyword that may have meant "cancel my appointment"')
// CANCEL / END / QUIT are carrier STOP keywords, and the appointment texts say
// "Reschedule or cancel: <link>". The opt-out is unconditional; a HUMAN has to be told that
// the client's appointment is still on the calendar.
const { isAppointmentAmbiguousOptOut, reviewOptOutAgainstUpcomingAppointment } = require(
  join(out, 'lib/booking/optout-appointment-review.js'),
)

await t('only the appointment-ambiguous keywords are flagged — a plain STOP is not noise', async () => {
  for (const body of ['cancel', 'CANCEL', 'End', 'quit', 'Cancel my meeting']) {
    assert.equal(isAppointmentAmbiguousOptOut(body), true, `${body} should be flagged`)
  }
  for (const body of ['stop', 'STOP', 'unsubscribe', 'stopall', 'optout', 'revoke', '']) {
    assert.equal(isAppointmentAmbiguousOptOut(body), false, `${body} should NOT be flagged`)
  }
})

// The review reads contacts → appointments; give the in-memory db those two tables.
state = makeState()
state.contacts = [{ id: 'contact-1' }]
state.upcoming = [{ id: 'appt-1', starts_at: '2026-12-01T16:00:00.000Z' }]
const flagged = await reviewOptOutAgainstUpcomingAppointment({
  channel: 'sms',
  contact: PHONE,
  body: 'CANCEL',
  nowIso: '2026-09-01T15:00:00.000Z',
})
await t('an upcoming appointment raises an FSA escalation, and does NOT cancel anything', async () => {
  assert.equal(flagged.flagged, true)
  const escalations = state.writes.filter((w) => w.table === 'agent_actions')
  assert.equal(escalations.length, 1)
  assert.equal(escalations[0].row.target_type, 'appointment')
  assert.equal(escalations[0].row.target_id, 'appt-1')
  assert.match(escalations[0].row.reason, /STILL SCHEDULED/)
  // The one thing it must never do.
  assert.equal(
    state.writes.filter((w) => w.table === 'appointments').length,
    0,
    'FSOS must never cancel an appointment on an inferred intention',
  )
})

state = makeState()
state.contacts = [{ id: 'contact-1' }]
state.upcoming = []
const nothingUpcoming = await reviewOptOutAgainstUpcomingAppointment({
  channel: 'sms',
  contact: PHONE,
  body: 'CANCEL',
  nowIso: '2026-09-01T15:00:00.000Z',
})
await t('no upcoming appointment ⇒ no escalation (the opt-out is unremarkable)', async () => {
  assert.equal(nothingUpcoming.flagged, false)
  assert.equal(state.writes.filter((w) => w.table === 'agent_actions').length, 0)
})

console.log('\nAn ordinary reply is not a consent event')
state = makeState()
await processInbound({ channel: 'sms', from: PHONE, body: 'sounds good, see you then' })
await t('a normal message writes no contact-consent row and no DNC row', async () => {
  assert.equal(consentWrites().length, 0)
  assert.equal(dncWrites('upsert').length, 0)
  assert.equal(dncWrites('delete').length, 0)
})

Module._load = origLoad
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
