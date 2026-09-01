// Booking SMS lifecycle — the END-TO-END proof for
//   Booking → SMS consent → appointment created → confirmation SMS → reminder SMS.
//
// This drives the REAL src/lib/booking/notify.ts (and the REAL gate classifier it keys its
// retry decision off) against an in-memory database whose booking_notification_deliveries table
// enforces the actual UNIQUE(appointment, schedule_version, event, offset, channel) constraint.
// Only the leaves are stubbed: the Supabase client (the in-memory db), the comms send path (a
// spy returning scripted gate outcomes), the A2P flag, and the transactional email fallback.
// Nothing that makes a decision under test is stubbed — the ledger arithmetic, the channel
// gating, the purpose classification and the retry/terminal split are all the shipped code.
//
// Covers each verification the workflow has to survive:
//   1. new booking + immediate confirmation SMS       6. duplicate-message prevention
//   2. purpose classification (quiet-hours scope)     7. SMS delivery failure + retry
//   3. scheduled reminders (both channels)            8. opt-out / STOP
//   4. rescheduled appointments                       9. bookings without SMS consent
//   5. cancelled appointments                        10. the A2P 10DLC hold
// Run: node tests/booking-sms-lifecycle.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)

// Manage links are HMAC-signed and the signer REFUSES a fallback key, so give it one.
process.env.BOOKING_TOKEN_KEY = 'test-booking-token-key'
process.env.NEXT_PUBLIC_SITE_URL = 'https://www.markistfsa.com'

// ── Compile the real modules under test (TS2307 on '@/…' is expected; JS still emits) ──
const out = mkdtempSync(join(tmpdir(), 'fsos-bk-sms-life-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})
try {
  execSync(
    `npx tsc src/lib/booking/notify.ts src/lib/comms/gate.ts src/lib/site.ts src/lib/data/query.ts ` +
      `--rootDir src --outDir ${out} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch {
  /* expected: unresolved '@/…' aliases */
}
for (const f of ['lib/booking/notify.js', 'lib/comms/gate.js', 'lib/site.js']) {
  if (!existsSync(join(out, f))) {
    console.error(`FATAL: ${f} was not emitted — the test cannot prove anything against a stub.`)
    process.exit(1)
  }
}

// ── In-memory database ───────────────────────────────────────────────────────
// Enforces the ledger's real UNIQUE key, so "fire once" is proven by the constraint the
// migration actually creates rather than by a mock that agrees with the caller.
const LEDGER_KEY = (r) => `${r.appointment_id}|${r.schedule_version}|${r.event}|${r.offset_minutes}|${r.channel}`

function makeState(overrides = {}) {
  return {
    appointments: [],
    // source_key → approved template row (absent ⇒ template_not_approved).
    templates: new Map([
      ['appointment-confirmation-sms', { id: 'tpl-conf-sms', subject: null, body: 'CONF SMS', body_text: null }],
      ['appointment-reminder-sms', { id: 'tpl-rem-sms', subject: null, body: 'REM SMS', body_text: null }],
      ['appointment-rescheduled-sms', { id: 'tpl-resch-sms', subject: null, body: 'RESCH SMS', body_text: null }],
      ['appointment-cancellation-sms', { id: 'tpl-cancel-sms', subject: null, body: 'CANCEL SMS', body_text: null }],
      ['appointment-confirmation', { id: 'tpl-conf-email', subject: 'Confirmed', body: 'CONF EMAIL', body_text: 'x' }],
      ['appointment-reminder-email', { id: 'tpl-rem-email', subject: 'Reminder', body: 'REM EMAIL', body_text: 'x' }],
      ['appointment-rescheduled', { id: 'tpl-resch-email', subject: 'Moved', body: 'RESCH EMAIL', body_text: 'x' }],
      ['appointment-cancellation', { id: 'tpl-cancel-email', subject: 'Cancelled', body: 'CANCEL EMAIL', body_text: 'x' }],
    ]),
    ledger: [],
    // contact ids that carry the durable booking-EMAIL consent-intent activity row.
    emailConsentContacts: new Set(),
    config: { offsets_minutes: [1440], email_enabled: true, sms_enabled: true },
    ...overrides,
  }
}

function makeDb(state) {
  const from = (table) => {
    const filters = {}
    let pendingUpsert = null
    let pendingUpsertOpts = null
    let pendingUpdate = null
    let op = 'select'

    const rowsFor = () => {
      if (table === 'appointments') {
        return state.appointments.filter((a) => {
          if (filters.id && a.id !== filters.id) return false
          if (filters.status && a.status !== filters.status) return false
          if (filters.starts_at_gt && !(a.starts_at > filters.starts_at_gt)) return false
          if (filters.starts_at_lte && !(a.starts_at <= filters.starts_at_lte)) return false
          if (filters.booked_at_gte && !(a.booked_at >= filters.booked_at_gte)) return false
          if (filters.updated_at_gte && !((a.updated_at ?? a.booked_at) >= filters.updated_at_gte)) return false
          if (filters.booked_via && a.booked_via !== filters.booked_via) return false
          if (filters.schedule_version !== undefined && a.schedule_version !== filters.schedule_version) return false
          return true
        })
      }
      if (table === 'comm_templates') {
        const tpl = state.templates.get(filters.source_key)
        return tpl ? [tpl] : []
      }
      if (table === 'activities') {
        return state.emailConsentContacts.has(filters.entity_id) ? [{ id: 'act-1' }] : []
      }
      if (table === 'booking_reminder_config') return state.config ? [state.config] : []
      if (table === 'booking_notification_deliveries') return state.ledger
      return []
    }

    const b = {
      select() {
        return b
      },
      eq(col, val) {
        if (col === 'source_key') filters.source_key = val
        else if (col === 'entity_id') filters.entity_id = val
        else filters[col] = val
        return b
      },
      gt(col, val) {
        if (col === 'starts_at') filters.starts_at_gt = val
        return b
      },
      gte(col, val) {
        if (col === 'booked_at') filters.booked_at_gte = val
        if (col === 'updated_at') filters.updated_at_gte = val
        return b
      },
      lte(col, val) {
        if (col === 'starts_at') filters.starts_at_lte = val
        return b
      },
      is() {
        return b
      },
      lt(col, val) {
        if (col === 'created_at') filters.created_at_lt = val
        return b
      },
      order() {
        return b
      },
      limit() {
        return b
      },
      upsert(row, opts) {
        op = 'upsert'
        pendingUpsert = row
        pendingUpsertOpts = opts
        return b
      },
      update(obj) {
        op = 'update'
        pendingUpdate = obj
        return b
      },
      insert() {
        op = 'insert'
        return b
      },
      delete() {
        op = 'delete'
        return b
      },
      async maybeSingle() {
        if (op === 'upsert' && table === 'booking_notification_deliveries') {
          const key = LEDGER_KEY(pendingUpsert)
          const exists = state.ledger.some((r) => LEDGER_KEY(r) === key)
          // ON CONFLICT DO NOTHING: an existing key returns NO row.
          if (exists) {
            assert.equal(pendingUpsertOpts?.ignoreDuplicates, true, 'the ledger claim must ignore duplicates')
            return { data: null, error: null }
          }
          const row = { id: `led-${state.ledger.length + 1}`, created_at: state.claimNow ?? NOW_ISO, ...pendingUpsert }
          state.ledger.push(row)
          return { data: { id: row.id }, error: null }
        }
        const rows = rowsFor()
        return { data: rows[0] ?? null, error: null }
      },
      // Terminal for the list queries (`await db.from(...)...limit(n)`) and for writes.
      then(resolve, reject) {
        try {
          if (op === 'update' && table === 'booking_notification_deliveries') {
            const row = state.ledger.find((r) => r.id === filters.id)
            if (row) Object.assign(row, pendingUpdate)
            return resolve({ data: null, error: null })
          }
          if (op === 'delete' && table === 'booking_notification_deliveries') {
            if (filters.id) {
              const i = state.ledger.findIndex((r) => r.id === filters.id)
              if (i >= 0) state.ledger.splice(i, 1)
              return resolve({ data: null, error: null })
            }
            // The stale-claim reaper: delete by status + created_at, returning what it released.
            const doomed = state.ledger.filter(
              (r) =>
                (!filters.status || r.status === filters.status) &&
                (!filters.created_at_lt || (r.created_at ?? '') < filters.created_at_lt),
            )
            for (const r of doomed) state.ledger.splice(state.ledger.indexOf(r), 1)
            return resolve({ data: doomed.map((r) => ({ id: r.id })), error: null })
          }
          if (op === 'insert' || op === 'update' || op === 'delete') return resolve({ data: null, error: null })
          return resolve({ data: rowsFor(), error: null })
        } catch (e) {
          return reject(e)
        }
      },
    }
    return b
  }
  return { from }
}

// ── Module hooks ─────────────────────────────────────────────────────────────
const sendSpy = { calls: [], script: () => ({ sent: true, blocked: false, messageId: 'msg-1', gate: { allowed: true, escalate: false } }) }
const a2pState = { approved: true }
let currentDb = null

// `then` must be undefined: a thenable Proxy makes `await stub()` recurse forever instead of
// resolving, which shows up as an unsettled top-level await rather than a useful failure.
const makeStub = () =>
  new Proxy(function () {}, {
    get: (_t, prop) => (prop === '__esModule' ? true : prop === 'then' ? undefined : makeStub()),
    apply: () => makeStub(),
  })

const HOOKS = {
  '@/lib/supabase/client': { __esModule: true, getDb: () => currentDb },
  '@/lib/comms/a2p': { __esModule: true, smsA2pApproved: () => a2pState.approved, smsLiveFor: (c) => c === 'email' || a2pState.approved },
  '@/lib/comms/send': {
    __esModule: true,
    async sendMessage(ctx) {
      sendSpy.calls.push(ctx)
      return sendSpy.script(ctx)
    },
  },
  '@/lib/notifications/transactional': {
    __esModule: true,
    sendVisitorAck: async () => ({ ok: false, error: 'stubbed' }),
    notifyFsa: async () => ({ ok: true }),
  },
  // unwrapOne's real semantics (PostgREST embeds arrive as an object or a 1-element array).
  '@/lib/data/query': { __esModule: true, unwrapOne: (v) => (Array.isArray(v) ? (v[0] ?? null) : v) },
}

const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (HOOKS[request]) return HOOKS[request]
  if (request.startsWith('@/')) {
    const emitted = join(out, request.slice(2) + '.js')
    if (existsSync(emitted)) return origLoad.call(this, emitted, ...rest)
    return makeStub()
  }
  return origLoad.call(this, request, ...rest)
}

const notify = require(join(out, 'lib/booking/notify.js'))
const realGate = require(join(out, 'lib/comms/gate.js'))

// ── Gate outcomes, shaped exactly as sendMessage returns them ────────────────
const SENT = { sent: true, blocked: false, messageId: 'msg-1', gate: { allowed: true, escalate: false } }
const BLOCKED_CONSENT = {
  sent: false,
  blocked: true,
  messageId: 'msg-b',
  reason: 'No valid channel consent on file.',
  gate: { allowed: false, blockedStep: 'consent', reason: 'No valid channel consent on file.', escalate: true },
}
const BLOCKED_DNC = {
  sent: false,
  blocked: true,
  messageId: 'msg-d',
  reason: 'Recipient is on the do-not-contact list.',
  gate: { allowed: false, blockedStep: 'dnc', reason: 'Recipient is on the do-not-contact list.', escalate: true },
}
// The gate CLEARED and Twilio then failed — dispatcher.ts reports gate.allowed=true, sent=false.
const PROVIDER_FAILED = {
  sent: false,
  blocked: true,
  messageId: 'msg-p',
  reason: 'Twilio request failed (503)',
  gate: { allowed: true, escalate: false },
}
// Twilio env not set — escalate:false, and it clears the moment an operator sets the credential.
const NOT_CONFIGURED = {
  sent: false,
  blocked: true,
  messageId: 'msg-n',
  reason: 'Twilio env not set.',
  gate: { allowed: false, blockedStep: 'not_configured', reason: 'Twilio env not set.', escalate: false },
}
const DEFERRED_FREQUENCY = {
  sent: false,
  blocked: true,
  messageId: 'msg-f',
  reason: 'Recipient frequency cap reached — held for a later cycle.',
  gate: { allowed: false, blockedStep: 'frequency', reason: 'held', escalate: false },
}

// Sanity: the retry/terminal split under test is the gate's own classification, not ours.
assert.equal(realGate.isDeferralGateStep('frequency'), true)
assert.equal(realGate.isDeferralGateStep('consent'), false)
assert.equal(realGate.isDeferralGateStep('dnc'), false)

// ── Fixtures ─────────────────────────────────────────────────────────────────
const NOW = new Date('2026-09-01T15:00:00.000Z')
const NOW_ISO = NOW.toISOString()
function appointment(over = {}) {
  return {
    id: 'appt-1',
    contact_id: 'contact-1',
    starts_at: '2026-09-03T16:00:00.000Z',
    booker_timezone: 'America/Chicago',
    meeting_mode: 'video',
    join_url: 'https://zoom.us/j/1',
    booked_at: '2026-09-01T14:55:00.000Z',
    booked_via: 'native',
    updated_at: '2026-09-01T14:55:00.000Z',
    status: 'scheduled',
    schedule_version: 1,
    reminder_sent_at: null,
    cancel_token: 'cancel-tok',
    reschedule_token: 'resch-tok',
    contacts: { full_name: 'Dana Reed', first_name: 'Dana', email: 'dana@example.com', phone: '+15125551234' },
    appointment_types: { name: 'Financial review', meeting_mode: 'video' },
    ...over,
  }
}

function setup(over = {}) {
  const state = makeState(over)
  state.appointments = [appointment(over.appointment ?? {})]
  currentDb = makeDb(state)
  sendSpy.calls = []
  sendSpy.script = () => SENT
  a2pState.approved = true
  return state
}

const smsCalls = () => sendSpy.calls.filter((c) => c.channel === 'sms')
const emailCalls = () => sendSpy.calls.filter((c) => c.channel === 'email')
const ledgerFor = (state, event, channel, offset = 0) =>
  state.ledger.filter((r) => r.event === event && r.channel === channel && r.offset_minutes === offset)

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

console.log('\n1. New booking → immediate confirmation SMS')
await t('a consented booking sends the confirmation on BOTH channels and records each leg', async () => {
  const state = setup()
  const outcome = await notify.sendBookingConfirmation('appt-1')
  assert.equal(outcome.sent, true, 'the email outcome is the caller-facing headline result')
  assert.equal(smsCalls().length, 1, 'exactly one confirmation SMS')
  assert.equal(emailCalls().length, 1, 'exactly one confirmation email')
  assert.equal(smsCalls()[0].body, 'CONF SMS', 'the SMS uses the approved appointment-confirmation-sms template')
  assert.equal(smsCalls()[0].templateId, 'tpl-conf-sms')
  assert.equal(ledgerFor(state, 'confirmation', 'sms').length, 1)
  assert.equal(ledgerFor(state, 'confirmation', 'sms')[0].status, 'sent')
})

await t('the SMS carries the appointment reference as its entity, for the audit trail', async () => {
  setup()
  await notify.sendBookingConfirmation('appt-1')
  assert.deepEqual(smsCalls()[0].entity, { type: 'appointment', id: 'appt-1' })
})

await t('the SMS never waives consent — the gate must resolve the opt-in itself', async () => {
  setup()
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls()[0].durableConsentGranted, false, 'an SMS waiver would bypass TCPA written consent')
})

await t('no approved SMS template ⇒ nothing is sent and NO fallback text is invented', async () => {
  const state = setup()
  state.templates.delete('appointment-confirmation-sms')
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls().length, 0)
  assert.equal(ledgerFor(state, 'confirmation', 'sms').length, 0, 'the claim is released so approval can rescue it')
})

console.log('\n2. Purpose classification — the quiet-hours scope for an immediate confirmation')
await t("the SMS leg is classified APPOINTMENT (transactional ⇒ not quiet-hours gated)", async () => {
  setup()
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls()[0].purpose, 'APPOINTMENT')
})
await t('the EMAIL leg is classified APPOINTMENT too, so both share the appointment caps', async () => {
  // While email was unclassified it counted against the OUTREACH frequency row's 3-touches-a-day
  // ceiling. The 24h + 12h + 1h cadence overruns that, and the leg refused would be the 1-hour
  // reminder — for anyone who resolves to a household member, i.e. every existing client.
  setup()
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(emailCalls()[0].purpose, 'APPOINTMENT')
})

await t('but appointment EMAIL stays on the MARKETING sending stream (owner directive)', async () => {
  // senders.ts would route a non-marketing purpose to the transactional identity. The stream is
  // an operator decision, not a consequence of classification, so it is pinned explicitly —
  // which is what keeps the delivered email identical to before the classification.
  setup()
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(emailCalls()[0].emailStream, 'marketing')
})

await t('the pin is on the email leg only — it is meaningless for SMS', async () => {
  setup()
  await notify.sendBookingConfirmation('appt-1')
  // Both legs go through one call shape, so the flag is present on the SMS context too; what
  // matters is that it can never change an SMS, which resolveSender is never consulted for.
  assert.equal(smsCalls()[0].channel, 'sms')
  assert.equal(smsCalls()[0].purpose, 'APPOINTMENT')
})
await t('appointment SMS is declared non-suppressible (transactional, not a marketing touch)', async () => {
  setup()
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls()[0].suppressible, false)
})
await t('both legs are exempt from the operator hours-of-operation window', async () => {
  // comm_hours_policy is seeded 09:00-19:00 Mon-Sat. That window governs OUTREACH; holding a
  // Sunday-evening booking's confirmation until Monday would contradict the screen that just
  // told the booker a text was on its way. The statutory quiet-hours floor is a separate step.
  setup()
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls()[0].businessHoursExempt, true)
  assert.equal(emailCalls()[0].businessHoursExempt, true)
})

console.log('\n3. Scheduled reminders')
await t('the reminder pass sends the SMS reminder for a due offset', async () => {
  const state = setup()
  state.emailConsentContacts.add('contact-1')
  state.appointments[0].starts_at = new Date(NOW.getTime() + 60 * 60_000).toISOString() // 1h out
  state.appointments[0].booked_at = '2026-08-20T00:00:00.000Z' // booked long before the window opened
  const res = await notify.runBookingReminderPass(NOW)
  assert.equal(res.scanned, 1)
  assert.equal(smsCalls().length, 1, 'one reminder SMS')
  assert.equal(smsCalls()[0].body, 'REM SMS')
  assert.equal(emailCalls().length, 1, 'and one reminder email')
})

await t('SMS reminders fire even when the contact has NO booking-EMAIL consent row', async () => {
  const state = setup() // emailConsentContacts deliberately empty
  state.appointments[0].starts_at = new Date(NOW.getTime() + 60 * 60_000).toISOString()
  state.appointments[0].booked_at = '2026-08-20T00:00:00.000Z'
  await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 1, 'the SMS opt-in stands on its own — it is not gated on an email record')
  assert.equal(emailCalls().length, 0, 'and the email leg is correctly withheld')
})

await t('SMS reminders survive email reminders being switched off', async () => {
  const state = setup()
  state.config = { offsets_minutes: [1440], email_enabled: false, sms_enabled: true }
  state.emailConsentContacts.add('contact-1')
  state.appointments[0].starts_at = new Date(NOW.getTime() + 60 * 60_000).toISOString()
  state.appointments[0].booked_at = '2026-08-20T00:00:00.000Z'
  await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 1)
  assert.equal(emailCalls().length, 0)
})

await t('both channels off ⇒ the pass does no work at all', async () => {
  const state = setup()
  state.config = { offsets_minutes: [1440], email_enabled: false, sms_enabled: false }
  const res = await notify.runBookingReminderPass(NOW)
  assert.equal(res.scanned, 0)
  assert.equal(sendSpy.calls.length, 0)
})

await t('multiple configured offsets each fire once, keyed independently', async () => {
  const state = setup()
  state.config = { offsets_minutes: [1440, 60], email_enabled: false, sms_enabled: true }
  state.appointments[0].starts_at = new Date(NOW.getTime() + 30 * 60_000).toISOString() // 30m out: both due
  state.appointments[0].booked_at = '2026-08-20T00:00:00.000Z'
  await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 2)
  assert.equal(ledgerFor(state, 'reminder', 'sms', 60).length, 1)
  assert.equal(ledgerFor(state, 'reminder', 'sms', 1440).length, 1)
})

await t('the shipped 24h + 12h + 1h cadence fires each offset once, on both channels', async () => {
  // The cadence migration 137 ships. Each offset is a distinct ledger key per channel, so the
  // sweep needs no code change to carry a third reminder — this pins that it actually does.
  const state = setup()
  state.config = { offsets_minutes: [1440, 720, 60], email_enabled: true, sms_enabled: true }
  state.emailConsentContacts.add('contact-1')
  state.appointments[0].booked_at = '2026-08-20T00:00:00.000Z' // long before any window opened
  state.appointments[0].starts_at = new Date(NOW.getTime() + 30 * 60_000).toISOString() // all three due
  for (let i = 0; i < 3; i++) await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 3, 'one reminder SMS per offset, however many ticks run')
  assert.equal(emailCalls().length, 3, 'and one reminder email per offset')
  for (const offset of [1440, 720, 60]) {
    assert.equal(ledgerFor(state, 'reminder', 'sms', offset).length, 1, `sms offset ${offset}`)
    assert.equal(ledgerFor(state, 'reminder', 'email', offset).length, 1, `email offset ${offset}`)
  }
})

await t('a booking made inside an offset window does not get that reminder', async () => {
  // Booked 40 minutes before the meeting: the confirmation already said when it is, so the 1h
  // reminder is suppressed while the wider offsets stay irrelevant (their windows opened before
  // the booking existed).
  const state = setup()
  state.config = { offsets_minutes: [1440, 720, 60], email_enabled: false, sms_enabled: true }
  state.appointments[0].starts_at = new Date(NOW.getTime() + 20 * 60_000).toISOString()
  state.appointments[0].booked_at = new Date(NOW.getTime() - 20 * 60_000).toISOString()
  await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 0, 'a reminder minutes after the confirmation is noise')
})

console.log('\n4. Rescheduled appointments')
await t('a reschedule sends the RESCHEDULED template, never a fresh confirmation', async () => {
  setup()
  await notify.sendAppointmentNotice('appt-1', 'rescheduled')
  assert.equal(smsCalls()[0].body, 'RESCH SMS')
  assert.equal(smsCalls()[0].templateId, 'tpl-resch-sms')
})

await t('a reschedule does NOT immediately fire the reminder it just re-armed', async () => {
  // The bump re-arms every offset under a new ledger key. Without re-anchoring the suppression
  // on the MOVE, an offset whose window opened days ago fires the instant the version changes —
  // texting "Reminder - your appointment is 4pm" seconds after "moved to 4pm".
  const state = setup()
  state.config = { offsets_minutes: [1440], email_enabled: false, sms_enabled: true }
  state.appointments[0].starts_at = new Date(NOW.getTime() + 60 * 60_000).toISOString()
  state.appointments[0].booked_at = '2026-08-20T00:00:00.000Z'
  state.appointments[0].schedule_version = 2
  state.appointments[0].updated_at = NOW.toISOString() // the move just happened
  await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 0, 'the reschedule notice already told them when it is')
})

await t('the NEW time re-arms the reminder, and fires it exactly once', async () => {
  const state = setup()
  state.config = { offsets_minutes: [1440], email_enabled: false, sms_enabled: true }
  state.appointments[0].booked_at = '2026-08-20T00:00:00.000Z'
  state.appointments[0].starts_at = new Date(NOW.getTime() + 60 * 60_000).toISOString()
  await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 1, 'the original 24h reminder')

  // Moved three days out: the 24h window has not opened yet, so nothing fires now…
  state.appointments[0].schedule_version = 2
  state.appointments[0].updated_at = NOW.toISOString()
  state.appointments[0].starts_at = new Date(NOW.getTime() + 3 * 24 * 60 * 60_000).toISOString()
  await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 1, 'too early for the new time\'s reminder')

  // …and once it opens, the new version fires exactly once however many ticks run.
  const later = new Date(NOW.getTime() + 2.5 * 24 * 60 * 60_000)
  for (let i = 0; i < 4; i++) await notify.runBookingReminderPass(later)
  assert.equal(smsCalls().length, 2, 'the new time re-arms the reminder, once')
  assert.deepEqual(
    state.ledger.filter((r) => r.event === 'reminder').map((r) => r.schedule_version).sort(),
    [1, 2],
  )
})

console.log('\n5. Cancelled appointments')
await t('a cancellation sends the CANCELLATION template on both channels', async () => {
  const state = setup()
  await notify.sendCancellationNotice('appt-1')
  assert.equal(smsCalls()[0].body, 'CANCEL SMS')
  assert.equal(emailCalls()[0].body, 'CANCEL EMAIL')
  assert.equal(ledgerFor(state, 'cancellation', 'sms').length, 1)
})

console.log('\n6. Duplicate-message prevention')
await t('re-invoking the same notice never sends twice (the ledger UNIQUE key is the guard)', async () => {
  const state = setup()
  await notify.sendBookingConfirmation('appt-1')
  await notify.sendBookingConfirmation('appt-1')
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls().length, 1, 'one confirmation SMS across three invocations')
  assert.equal(emailCalls().length, 1)
  assert.equal(state.ledger.filter((r) => r.event === 'confirmation' && r.channel === 'sms').length, 1)
})

await t('overlapping reminder ticks send each offset at most once', async () => {
  const state = setup()
  state.config = { offsets_minutes: [1440], email_enabled: false, sms_enabled: true }
  state.appointments[0].starts_at = new Date(NOW.getTime() + 60 * 60_000).toISOString()
  state.appointments[0].booked_at = '2026-08-20T00:00:00.000Z'
  for (let i = 0; i < 5; i++) await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 1)
})

await t('the confirmation retry pass never re-sends a confirmation that already went out', async () => {
  const state = setup()
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls().length, 1)
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(smsCalls().length, 1, 'still one')
  assert.equal(res.skipped, 1)
})

console.log('\n7. SMS delivery failures')
await t('a self-clearing hold releases the claim so a later tick retries', async () => {
  const state = setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? DEFERRED_FREQUENCY : SENT)
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(ledgerFor(state, 'confirmation', 'sms').length, 0, 'no ledger row survives a retryable hold')
})

await t('a TRANSPORT failure (gate cleared, Twilio errored) is retried, not written off', async () => {
  const state = setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? PROVIDER_FAILED : SENT)
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(
    ledgerFor(state, 'confirmation', 'sms').length,
    0,
    'a Twilio outage must not permanently write off the confirmation — the claim is released',
  )
  sendSpy.script = () => SENT
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.sent, 1)
  assert.equal(ledgerFor(state, 'confirmation', 'sms')[0].status, 'sent')
})

await t('an UNCONFIGURED provider is a hold, not a verdict — every SMS in that window survives', async () => {
  // 'not_configured' is escalate:false and clears when an operator sets the credential. Writing
  // it off would permanently lose every appointment text placed while Twilio was misconfigured.
  const state = setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? NOT_CONFIGURED : SENT)
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(ledgerFor(state, 'confirmation', 'sms').length, 0, 'the claim is released, not settled')
  sendSpy.script = () => SENT
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.sent, 1, 'and it delivers once the credential is set')
})

await t('the confirmation retry pass re-drives a confirmation SMS that did not go out', async () => {
  const state = setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? DEFERRED_FREQUENCY : SENT)
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls().length, 1, 'attempted at booking')
  sendSpy.script = () => SENT // the hold clears
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.sent, 1)
  assert.equal(smsCalls().length, 2, 'and delivered on the retry')
  assert.equal(ledgerFor(state, 'confirmation', 'sms')[0].status, 'sent')
})

await t('the retry pass leaves a change older than its window alone', async () => {
  const state = setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? DEFERRED_FREQUENCY : SENT)
  await notify.sendBookingConfirmation('appt-1')
  state.appointments[0].updated_at = '2026-08-01T00:00:00.000Z' // long past the retry window
  sendSpy.calls = []
  sendSpy.script = () => SENT
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.scanned, 0)
  assert.equal(smsCalls().length, 0, 'a stale notice is never resurrected')
})

await t('a RESCHEDULED appointment is never given a second "you are confirmed" text', async () => {
  // The mover bumps schedule_version, which re-arms EVERY leg under a new ledger key — so the
  // ledger alone cannot stop a confirmation being re-sent after a reschedule. The owed notice is
  // derived from the appointment's current state, and a moved appointment owes 'rescheduled'.
  const state = setup()
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls()[0].body, 'CONF SMS')
  state.appointments[0].schedule_version = 2 // as the mover leaves it
  state.appointments[0].updated_at = '2026-09-01T14:58:00.000Z'
  sendSpy.calls = []
  await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(smsCalls().length, 1)
  assert.equal(smsCalls()[0].body, 'RESCH SMS', 'the moved appointment owes the reschedule notice, not a confirmation')
})

await t('a held RESCHEDULE notice is re-driven — immediate notices are no longer one-shot', async () => {
  const state = setup()
  state.appointments[0].schedule_version = 2
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? DEFERRED_FREQUENCY : SENT)
  await notify.sendAppointmentNotice('appt-1', 'rescheduled')
  assert.equal(smsCalls().length, 1, 'attempted when the move happened')
  sendSpy.script = () => SENT
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.sent, 1)
  assert.equal(smsCalls().length, 2, 'and delivered on the retry')
})

await t('a held CANCELLATION notice is re-driven too', async () => {
  const state = setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? DEFERRED_FREQUENCY : SENT)
  await notify.sendCancellationNotice('appt-1')
  state.appointments[0].status = 'cancelled'
  sendSpy.script = () => SENT
  sendSpy.calls = []
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.sent, 1)
  assert.equal(smsCalls()[0].body, 'CANCEL SMS')
})

await t('an appointment the FSA entered by hand is not given a confirmation it never had', async () => {
  const state = setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? DEFERRED_FREQUENCY : SENT)
  await notify.sendBookingConfirmation('appt-1')
  state.appointments[0].booked_via = 'manual'
  sendSpy.calls = []
  sendSpy.script = () => SENT
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.scanned, 0, 'only a PUBLIC booking is owed a confirmation')
  assert.equal(smsCalls().length, 0)
})

await t('the owed-notice mapping is derived from the row alone', async () => {
  const at = (o) => notify.owedImmediateNotice({ status: 'scheduled', scheduleVersion: 1, bookedVia: 'native', startsAt: '2026-09-03T16:00:00.000Z', ...o }, NOW)
  assert.equal(at({}), 'confirmation')
  assert.equal(at({ scheduleVersion: 3 }), 'rescheduled')
  assert.equal(at({ bookedVia: 'manual' }), null, 'a hand-entered booking was never owed a confirmation')
  assert.equal(at({ startsAt: '2026-08-01T00:00:00.000Z' }), null, 'the meeting has already happened')
  assert.equal(at({ status: 'cancelled' }), 'cancellation')
  assert.equal(at({ status: 'completed' }), 'recap')
  assert.equal(at({ status: 'no_show' }), 'no_show_followup')
})

await t('the retry pass does nothing while booking SMS is switched off', async () => {
  const state = setup()
  state.config = { offsets_minutes: [1440], email_enabled: true, sms_enabled: false }
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.scanned, 0)
  assert.equal(sendSpy.calls.length, 0)
})

console.log('\n7b. A tick that dies mid-send')
await t('an abandoned claim is released so the leg can be retried, never lost', async () => {
  // The claim is written as 'deferred' and promoted by the outcome, so a row still reading
  // 'deferred' long afterwards is a leg nobody finished. The UNIQUE key would otherwise make it
  // unclaimable for the life of its schedule_version — the one silent, permanent loss path.
  const state = setup()
  state.ledger.push({
    id: 'led-stale',
    appointment_id: 'appt-1',
    schedule_version: 1,
    event: 'confirmation',
    offset_minutes: 0,
    channel: 'sms',
    status: 'deferred',
    created_at: new Date(NOW.getTime() - 60 * 60_000).toISOString(), // an hour ago
  })
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.reaped, 1, 'the abandoned claim is released')
  assert.equal(res.sent, 1, 'and the leg delivers on this very tick')
})

await t('a claim that is genuinely mid-send right now is NOT reaped', async () => {
  const state = setup()
  state.ledger.push({
    id: 'led-fresh',
    appointment_id: 'appt-1',
    schedule_version: 1,
    event: 'confirmation',
    offset_minutes: 0,
    channel: 'sms',
    status: 'deferred',
    created_at: new Date(NOW.getTime() - 60_000).toISOString(), // a minute ago
  })
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.reaped, 0, 'a leg still in flight must never have its claim pulled')
  assert.equal(smsCalls().length, 0, 'and it is not re-sent')
})

await t('a SENT ledger row is never reaped, however old', async () => {
  const state = setup()
  state.ledger.push({
    id: 'led-sent',
    appointment_id: 'appt-1',
    schedule_version: 1,
    event: 'confirmation',
    offset_minutes: 0,
    channel: 'sms',
    status: 'sent',
    created_at: '2026-01-01T00:00:00.000Z',
  })
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.reaped, 0)
  assert.equal(smsCalls().length, 0, 'a delivered confirmation is never re-sent')
})

console.log('\n8. Opt-out / STOP')
await t('a DNC-blocked SMS settles TERMINALLY and is never re-attempted', async () => {
  const state = setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? BLOCKED_DNC : SENT)
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls().length, 1)
  const row = ledgerFor(state, 'confirmation', 'sms')[0]
  assert.ok(row, 'the block is recorded on the ledger, not silently dropped')
  assert.equal(row.status, 'blocked')
  assert.equal(row.block_reason, 'dnc')
  // Every later tick must leave it alone — an opt-out is not a hold to retry.
  for (let i = 0; i < 5; i++) await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(smsCalls().length, 1, 'a STOPped number is never re-messaged')
})

await t('an opt-out never blocks the appointment EMAIL', async () => {
  setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? BLOCKED_DNC : SENT)
  const outcome = await notify.sendBookingConfirmation('appt-1')
  assert.equal(outcome.sent, true)
  assert.equal(emailCalls().length, 1)
})

console.log('\n9. Bookings WITHOUT SMS consent')
await t('the SMS leg is attempted once, recorded with its reason, and never churns', async () => {
  const state = setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? BLOCKED_CONSENT : SENT)
  state.appointments[0].starts_at = new Date(NOW.getTime() + 60 * 60_000).toISOString()
  state.appointments[0].booked_at = '2026-08-20T00:00:00.000Z'
  state.config = { offsets_minutes: [1440], email_enabled: false, sms_enabled: true }
  for (let i = 0; i < 10; i++) await notify.runBookingReminderPass(NOW)
  assert.equal(smsCalls().length, 1, 'ONE attempt across ten ticks, not one per tick')
  const row = ledgerFor(state, 'reminder', 'sms', 1440)[0]
  assert.equal(row.status, 'blocked')
  assert.equal(row.block_reason, 'consent')
})

await t('a contact with no phone never even claims a ledger row', async () => {
  // Checked before the claim: running the full gate (and its blocked-send escalation) on every
  // offset to rediscover "there is no number" is pure noise.
  const state = setup()
  state.appointments[0].contacts = { full_name: 'No Phone', first_name: 'No', email: 'np@example.com', phone: null }
  const before = state.ledger.length
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls().length, 0)
  assert.equal(ledgerFor(state, 'confirmation', 'sms').length, 0)
  assert.equal(state.ledger.length, before + 1, 'only the email leg claimed')
})

await t('the confirmation EMAIL is unaffected by the absence of SMS consent', async () => {
  setup()
  sendSpy.script = (ctx) => (ctx.channel === 'sms' ? BLOCKED_CONSENT : SENT)
  const outcome = await notify.sendBookingConfirmation('appt-1')
  assert.equal(outcome.sent, true)
  assert.equal(emailCalls().length, 1)
})

console.log('\n10. The A2P 10DLC hold')
await t('SMS is not even claimed while A2P is not live — and delivers once it is', async () => {
  const state = setup()
  a2pState.approved = false
  await notify.sendBookingConfirmation('appt-1')
  assert.equal(smsCalls().length, 0)
  assert.equal(ledgerFor(state, 'confirmation', 'sms').length, 0, 'no claim is burned by the hold')
  a2pState.approved = true
  const res = await notify.runBookingNoticeRetryPass(NOW)
  assert.equal(res.sent, 1)
  assert.equal(smsCalls().length, 1)
})

Module._load = origLoad
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
