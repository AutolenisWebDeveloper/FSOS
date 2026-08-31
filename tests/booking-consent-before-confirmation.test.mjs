// The ordering the whole workflow rests on:
//   booking submitted → SMS consent RECORDED → confirmation sent.
//
// The gate resolves SMS consent from the store at send time. If bookAppointment fired the
// confirmation while the consent write was still in flight — or worse, never awaited it — the
// confirmation SMS would race its own consent record and be blocked for "no consent on file",
// with no retry behind it. The requirement is explicit that consent is collected inside the
// booking flow precisely so the confirmation can go out immediately afterwards, so this is the
// sequencing that has to hold.
//
// Proven by making the consent capture SLOW: a capture that is not awaited lets the confirmation
// call land first, and the ordering assertion fails.
//
// Drives the REAL bookAppointment. Stubbed: the availability engine, contact resolution, Zoom,
// the transactional mailer, the audit log, and the two collaborators whose call order is the
// subject of the test (so their ordering is observed, not simulated).
// Run: node tests/booking-consent-before-confirmation.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)

const out = mkdtempSync(join(process.cwd(), 'node_modules', '.fsos-bk-order-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})
try {
  execSync(
    `npx tsc src/lib/booking/book.ts src/lib/contacts/normalize.ts src/lib/site.ts ` +
      `--rootDir src --outDir ${out} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch {
  /* expected: unresolved '@/…' aliases */
}
if (!existsSync(join(out, 'lib/booking/book.js'))) {
  console.error('FATAL: book.js was not emitted')
  process.exit(1)
}

// ── Recorded call order ──────────────────────────────────────────────────────
const events = []
let consentDelayMs = 25

const makeStub = () =>
  new Proxy(function () {}, {
    get: (_t, prop) => (prop === '__esModule' ? true : prop === 'then' ? undefined : makeStub()),
    apply: () => makeStub(),
  })

const TYPE = {
  id: 'type-1',
  slug: 'financial-review',
  name: 'Financial review',
  host_user_id: 'host-1',
  duration_minutes: 30,
  meeting_mode: 'video',
}
const SLOT = { startsAt: '2026-09-10T16:00:00.000Z', endsAt: '2026-09-10T16:30:00.000Z' }

const writes = []
const db = {
  from(table) {
    let op = 'select'
    const b = {
      select: () => b,
      eq: () => b,
      or: () => b,
      is: () => b,
      limit: () => b,
      insert(row) {
        op = 'insert'
        writes.push({ table, row })
        return b
      },
      update(row) {
        op = 'update'
        writes.push({ table, row, update: true })
        return b
      },
      async maybeSingle() {
        if (table === 'appointments' && op === 'insert') return { data: { id: 'appt-1' }, error: null }
        if (table === 'contacts' && op === 'select') return { data: null, error: null }
        return { data: null, error: null }
      },
      async single() {
        if (table === 'contacts') return { data: { id: 'contact-1' }, error: null }
        return { data: null, error: null }
      },
      then: (resolve) => resolve({ data: [], error: null }),
    }
    return b
  },
}

const HOOKS = {
  '@/lib/supabase/client': { __esModule: true, getDb: () => db },
  '@/lib/audit/log': { __esModule: true, writeAudit: async () => ({ ok: true }) },
  '@/lib/zoom/client': { __esModule: true, zoomEnabled: () => false, createZoomMeeting: async () => ({ ok: false }) },
  '@/lib/tokens': {
    __esModule: true,
    generateFormToken: () => 'tok-' + writes.length,
    referenceFromToken: () => 'REF-1234',
  },
  '@/lib/import/resolution': {
    __esModule: true,
    buildContactIndex: () => ({}),
    resolveContact: () => ({ action: 'create' }),
  },
  '@/lib/notifications/transactional': {
    __esModule: true,
    notifyFsa: async () => ({ ok: true }),
    sendVisitorAck: async () => ({ ok: true }),
  },
}

// The two collaborators whose ORDER is the subject of the test.
const RELATIVE_HOOKS = {
  './sms-consent': {
    __esModule: true,
    async captureBookingSmsConsent(input) {
      events.push({ at: 'consent:start', appointmentId: input.appointmentId })
      await new Promise((r) => setTimeout(r, consentDelayMs))
      events.push({ at: 'consent:done', appointmentId: input.appointmentId })
      return { recorded: true, consentVersion: 'v1', contactKey: '+15125551234', memberId: null, memberGrant: 'not_a_member' }
    },
  },
  './notify': {
    __esModule: true,
    async sendBookingConfirmation(appointmentId) {
      events.push({ at: 'confirmation:start', appointmentId })
      return { sent: true }
    },
  },
  './slots': {
    __esModule: true,
    computeSlotsForType: async () => ({ ok: true, type: TYPE, slots: [SLOT] }),
  },
}

const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (HOOKS[request]) return HOOKS[request]
  if (RELATIVE_HOOKS[request]) return RELATIVE_HOOKS[request]
  if (request.startsWith('@/')) {
    const emitted = join(out, request.slice(2) + '.js')
    if (existsSync(emitted)) return origLoad.call(this, emitted, ...rest)
    return makeStub()
  }
  return origLoad.call(this, request, ...rest)
}

const { bookAppointment } = require(join(out, 'lib/booking/book.js'))

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

const NOW = '2026-09-01T15:00:00.000Z'
const BASE = {
  typeSlug: 'financial-review',
  startsAt: SLOT.startsAt,
  bookerTimezone: 'America/Chicago',
  name: 'Dana Reed',
  email: 'dana@example.com',
  phone: '+15125551234',
  reason: 'general_consultation',
  notes: null,
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (test)',
}

const idx = (at) => events.findIndex((e) => e.at === at)

console.log('an opted-in booking')
events.length = 0
writes.length = 0
const optedIn = await bookAppointment({ ...BASE, smsOptIn: true }, NOW)

await t('the booking succeeds', async () => {
  assert.equal(optedIn.ok, true)
  assert.equal(optedIn.confirmation.reference, 'REF-1234')
})
await t('consent is captured, and captured against the appointment just created', async () => {
  assert.ok(idx('consent:start') >= 0, 'the SMS consent capture must run')
  assert.equal(events[idx('consent:start')].appointmentId, 'appt-1', 'the booking reference must be the real one')
})
await t('the consent write COMPLETES before the confirmation is sent', async () => {
  assert.ok(idx('consent:done') >= 0)
  assert.ok(idx('confirmation:start') >= 0, 'the confirmation must be sent')
  assert.ok(
    idx('consent:done') < idx('confirmation:start'),
    'the confirmation SMS would race its own consent record and be blocked for "no consent on file"',
  )
})
await t('the confirmation targets the appointment that was created', async () => {
  assert.equal(events[idx('confirmation:start')].appointmentId, 'appt-1')
})

console.log('\na booking that does NOT opt in')
events.length = 0
writes.length = 0
const optedOut = await bookAppointment({ ...BASE, smsOptIn: false }, NOW)

await t('the booking still succeeds', async () => {
  assert.equal(optedOut.ok, true)
})
await t('NO consent record is written — absence of a tick is never treated as consent', async () => {
  assert.equal(idx('consent:start'), -1)
})
await t('the confirmation is still sent (email is unaffected by the SMS decision)', async () => {
  assert.ok(idx('confirmation:start') >= 0)
})

console.log('\na booking with a phone but no opt-in, and an opt-in with no phone')
events.length = 0
await bookAppointment({ ...BASE, phone: '+15125551234', smsOptIn: undefined }, NOW)
await t('an absent opt-in flag is treated as NO consent', async () => {
  assert.equal(idx('consent:start'), -1)
})
events.length = 0
await bookAppointment({ ...BASE, phone: null, smsOptIn: true }, NOW)
await t('an opt-in without a number records nothing — no consent for a number we do not have', async () => {
  assert.equal(idx('consent:start'), -1, 'a consent record for a missing number would be unusable evidence')
})

Module._load = origLoad
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
