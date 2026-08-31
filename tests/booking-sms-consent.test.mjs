// Native booking — SMS consent capture→gate round-trip proof (P5.3, Stage 3).
// Booking SMS consent is written to comm_contact_consents (the ONE contact-resolvable SMS
// consent store, mig 074) exactly as the public contact form + STOP/HELP use it — never a
// second path. This proves the CONTRACT the round-trip depends on, entirely offline, using the
// SAME pure helpers both the capture (book.ts → consentContactKey) and the gate resolver
// (send.ts → smsTail + `ilike %tail` + latestConsentGranted) call:
//   • the key the capture stores suffix-matches what the gate queries (so a grant is found);
//   • a `granted` row reads as consent-present; a later STOP `revoked` flips it to blocked;
//   • an unchecked box (no row) is fail-closed (no consent);
//   • a sub-10-digit number can't produce a usable grant (mirrors the schema's phone requirement).
// Run: node tests/booking-sms-consent.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import Module from 'node:module'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Output INSIDE the repo so the compiled config-schemas.js resolves `zod` from the repo's
// node_modules (a /tmp outDir cannot). Cleaned up in the finally below.
const out = mkdtempSync(join(process.cwd(), 'node_modules', '.fsos-bk-sms-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))
execSync(
  `npx tsc src/lib/comms/contact-consent.ts src/lib/booking/config-schemas.ts src/lib/site.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { consentContactKey, smsTail, latestConsentGranted } = require(join(out, 'comms/contact-consent.js'))
const { PublicBookingInput } = require(join(out, 'booking/config-schemas.js'))
const { SMS_CONSENT, BUSINESS } = require(join(out, 'site.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// The gate query (send.ts): channel='sms' AND contact ILIKE %<tail>, newest captured_at wins.
// Emulate the suffix match the DB does, over whatever key the capture stored.
function gateFindsGrant(storedContactKey, storedRows, sendToPhone) {
  const tail = smsTail(sendToPhone)
  if (tail.length < 10) return false // gate's guard: no usable number, no consent
  if (!storedContactKey.endsWith(tail)) return false // ILIKE %tail would not match this row
  return latestConsentGranted(storedRows)
}

console.log('capture key ↔ gate query alignment (same helpers on both sides)')
t('the stored contact key suffix-matches the gate tail for every common phone format', () => {
  for (const phone of ['+15125551234', '5125551234', '(512) 555-1234', '512-555-1234', '1 512 555 1234']) {
    const stored = consentContactKey('sms', phone) // what book.ts writes to comm_contact_consents.contact
    const tail = smsTail(phone) // what send.ts queries by
    assert.equal(tail, '5125551234')
    assert.ok(stored.endsWith(tail), `stored key ${stored} must end with tail ${tail}`)
  }
})

console.log('capture → gate round-trip')
const phone = '+1 (512) 555-1234'
const captured = consentContactKey('sms', phone)
t('an affirmative opt-in makes the gate resolve consent PRESENT for that number', () => {
  const rows = [{ action: 'granted', captured_at: '2026-08-03T15:00:00Z' }]
  assert.equal(gateFindsGrant(captured, rows, '512-555-1234'), true)
})
t('a later STOP (revoked) flips the very next send to BLOCKED (latest wins)', () => {
  const rows = [
    { action: 'granted', captured_at: '2026-08-03T15:00:00Z' },
    { action: 'revoked', captured_at: '2026-08-03T16:00:00Z' },
  ]
  assert.equal(gateFindsGrant(captured, rows, '512-555-1234'), false)
})
t('a re-grant (START) after a STOP restores consent (newest captured_at wins)', () => {
  const rows = [
    { action: 'granted', captured_at: '2026-08-03T15:00:00Z' },
    { action: 'revoked', captured_at: '2026-08-03T16:00:00Z' },
    { action: 'granted', captured_at: '2026-08-03T17:00:00Z' },
  ]
  assert.equal(gateFindsGrant(captured, rows, '512-555-1234'), true)
})
t('an UNCHECKED box writes no row → gate is fail-closed (no consent)', () => {
  assert.equal(gateFindsGrant(captured, [], '512-555-1234'), false)
  assert.equal(latestConsentGranted([]), false)
})
t('a different number never inherits this booker consent (no cross-number match)', () => {
  const rows = [{ action: 'granted', captured_at: '2026-08-03T15:00:00Z' }]
  assert.equal(gateFindsGrant(captured, rows, '972-555-9999'), false)
})
t('a sub-10-digit number cannot produce a usable grant (mirrors the schema phone requirement)', () => {
  const short = '555-1234'
  const shortKey = consentContactKey('sms', short)
  const rows = [{ action: 'granted', captured_at: '2026-08-03T15:00:00Z' }]
  assert.equal(gateFindsGrant(shortKey, rows, short), false)
})

console.log('schema: SMS opt-in is separate + requires a valid phone (never inferred)')
const baseBooking = {
  typeSlug: 'intro-call',
  startsAt: '2026-08-10T14:00:00Z',
  bookerTimezone: 'America/Chicago',
  name: 'Dana Rivers',
  email: 'dana@example.com',
  reason: 'general_consultation', // required meeting-topic field (APPOINTMENT_REASONS)
}
t('default is UNCHECKED — a booking without the field opts into no SMS', () => {
  const r = PublicBookingInput.safeParse({ ...baseBooking })
  assert.equal(r.success, true)
  assert.equal(r.data.sms_opt_in, false)
})
t('opting into SMS WITHOUT a phone fails validation on the phone field', () => {
  const r = PublicBookingInput.safeParse({ ...baseBooking, sms_opt_in: true })
  assert.equal(r.success, false)
  const fe = r.error.flatten().fieldErrors
  assert.ok(fe.phone && fe.phone.length > 0, 'expected a phone field error')
})
t('opting into SMS with a sub-10-digit phone fails validation', () => {
  const r = PublicBookingInput.safeParse({ ...baseBooking, sms_opt_in: true, phone: '555-1234' })
  assert.equal(r.success, false)
  assert.ok(r.error.flatten().fieldErrors.phone)
})
t('opting into SMS with a valid phone passes', () => {
  const r = PublicBookingInput.safeParse({ ...baseBooking, sms_opt_in: true, phone: '(512) 555-1234' })
  assert.equal(r.success, true)
  assert.equal(r.data.sms_opt_in, true)
})
t('phone stays OPTIONAL when SMS is not opted into', () => {
  const r = PublicBookingInput.safeParse({ ...baseBooking, sms_opt_in: false })
  assert.equal(r.success, true)
  assert.equal(r.data.phone, null)
})

console.log('the disclosure the booker sees is the disclosure that is stored')
// The booking form renders SMS_CONSENT.disclosure verbatim and book.ts persists that same
// string as consent_text, so these assertions are simultaneously a UI-copy contract and an
// evidence contract: whatever this string says is what the consent record can be defended with.
t('the disclosure names every appointment message class the workflow sends', () => {
  const d = SMS_CONSENT.disclosure
  assert.match(d, /appointment confirmations/i, 'confirmations must be disclosed')
  assert.match(d, /reminders/i, 'reminders must be disclosed')
  assert.match(d, /reschedule/i, 'reschedule notices must be disclosed')
  assert.match(d, /cancellation/i, 'cancellation notices must be disclosed')
})
t('the disclosure carries the carrier-required A2P elements', () => {
  const d = SMS_CONSENT.disclosure
  assert.match(d, /Msg frequency varies/i)
  assert.match(d, /Msg & data rates may apply/i)
  assert.match(d, /Reply STOP to opt out/i)
  assert.match(d, /HELP for help/i)
  assert.match(d, /not a condition of purchase/i)
  assert.match(d, /Privacy Policy/i)
  assert.match(d, /SMS Terms/i)
  assert.ok(d.includes(SMS_CONSENT.from), 'must name the origination number')
})
t('the disclosure is customer-care only — no marketing consent is smuggled in', () => {
  assert.doesNotMatch(SMS_CONSENT.disclosure, /marketing|promotion|offer|discount|quote/i)
})

console.log('the two surfaces that RENDER the disclosure cannot drift from the stored bytes')
// consent_version is a hash of SMS_CONSENT.disclosure, and consent_text stores that same string.
// So a surface whose visible wording drifts from the constant produces evidence that does not
// match what the person actually read — the one way a consent record becomes indefensible.
// BookingFlow interpolates the constant directly and cannot drift; SiteContactForm hand-copies
// it into JSX (it needs inline links), so it is checked here character by character.
const contactFormSrc = readFileSync('src/components/public/site/SiteContactForm.tsx', 'utf8')

/** The visible text of the consent <label> in SiteContactForm.tsx, JSX resolved. */
function renderedContactFormDisclosure(src) {
  const start = src.indexOf('<label htmlFor="sms-consent">')
  const end = src.indexOf('</label>', start)
  assert.ok(start > 0 && end > start, 'the SiteContactForm consent label could not be located')
  return src
    .slice(src.indexOf('>', start) + 1, end)
    .replace(/\{' '\}/g, ' ') // explicit JSX spacers
    .replace(/\{BUSINESS\.brand\}/g, BUSINESS.brand)
    .replace(/\{SMS_CONSENT\.from\}/g, SMS_CONSENT.from)
    .replace(/<[^>]+>/g, '') // <Link> wrappers — the link TEXT is the visible wording
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

t('SiteContactForm renders SMS_CONSENT.disclosure verbatim (no unresolved JSX left over)', () => {
  const rendered = renderedContactFormDisclosure(contactFormSrc)
  assert.doesNotMatch(rendered, /[{}]/, 'an unresolved JSX expression leaked into the comparison')
  assert.equal(rendered, SMS_CONSENT.disclosure.replace(/\s+/g, ' ').trim())
})

t('the booking form interpolates the constant instead of hand-copying it', () => {
  const bookingSrc = readFileSync('src/components/public/booking/BookingFlow.tsx', 'utf8')
  assert.match(bookingSrc, /\{SMS_CONSENT\.disclosure\}/, 'the booking form must render the constant itself')
})

t('the booking form makes the three named documents reachable', () => {
  // The disclosure NAMES a Privacy Policy, Terms of Use and SMS Terms; naming them without a
  // way to open them is not a disclosure.
  const bookingSrc = readFileSync('src/components/public/booking/BookingFlow.tsx', 'utf8')
  for (const href of ['/privacy', '/terms', '/sms-terms']) {
    assert.ok(bookingSrc.includes(`href="${href}"`), `the booking consent block must link ${href}`)
  }
})

console.log('booking consent capture — the real captureBookingSmsConsent against a mock store')
// The shipped module, loaded for real: only the leaves (db, audit, consent-event recorder) are
// stubbed, so the rows asserted below are the rows production writes.
const capOut = mkdtempSync(join(process.cwd(), 'node_modules', '.fsos-bk-cap-'))
process.on('exit', () => rmSync(capOut, { recursive: true, force: true }))
try {
  execSync(
    `npx tsc src/lib/booking/sms-consent.ts src/lib/comms/consent-version.ts src/lib/comms/contact-consent.ts src/lib/site.ts ` +
      `--rootDir src --outDir ${capOut} ` +
      `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch {
  /* expected: unresolved '@/…' aliases */
}
if (!existsSync(join(capOut, 'lib/booking/sms-consent.js'))) {
  console.error('FATAL: sms-consent.js was not emitted')
  process.exit(1)
}

const writes = []
let memberLink = { memberId: null, householdId: null, agencyId: null }
let memberChannelStatus = null
// Set to a Postgres error to simulate a schema that predates migration 135.
let consentInsertError = null
const mockDb = {
  from(table) {
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: async () =>
        table === 'consents' ? { data: memberChannelStatus ? { status: memberChannelStatus } : null, error: null } : { data: null, error: null },
      insert(row) {
        writes.push({ table, op: 'insert', row })
        const err =
          table === 'comm_contact_consents' && consentInsertError && 'appointment_id' in row ? consentInsertError : null
        return Object.assign(Promise.resolve({ data: null, error: err }), b)
      },
      upsert(row) {
        writes.push({ table, op: 'upsert', row })
        return Object.assign(Promise.resolve({ data: null, error: null }), b)
      },
      then: (res) => res({ data: null, error: null }),
    }
    return b
  },
}
const audits = []
const CAP_HOOKS = {
  '@/lib/supabase/client': { __esModule: true, getDb: () => mockDb },
  '@/lib/audit/log': { __esModule: true, writeAudit: async (e) => { audits.push(e); return { ok: true } } },
  '@/lib/comms/conversations': { __esModule: true, resolveContact: async () => memberLink },
  '@/lib/comms/consent-events': { __esModule: true, recordConsentChange: async () => ({ audited: true }) },
}
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (CAP_HOOKS[request]) return CAP_HOOKS[request]
  if (request.startsWith('@/')) {
    const emitted = join(capOut, request.slice(2) + '.js')
    if (!existsSync(emitted)) throw new Error(`unstubbed alias in the capture test: ${request}`)
    return origLoad.call(this, emitted, ...rest)
  }
  return origLoad.call(this, request, ...rest)
}
const { captureBookingSmsConsent, mayGrantMemberAppointmentConsent } = require(join(capOut, 'lib/booking/sms-consent.js'))

const CAPTURE_INPUT = {
  contactId: 'contact-9',
  appointmentId: 'appt-9',
  phone: '+1 (512) 555-1234',
  capturedAt: '2026-09-01T15:00:00.000Z',
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (test)',
}
const rowsFor = (table) => writes.filter((w) => w.table === table)

async function capture(opts = {}) {
  writes.length = 0
  audits.length = 0
  memberLink = opts.memberLink ?? { memberId: null, householdId: null, agencyId: null }
  memberChannelStatus = opts.memberChannelStatus ?? null
  consentInsertError = opts.consentInsertError ?? null
  return captureBookingSmsConsent(CAPTURE_INPUT)
}

const capResult = await capture()
t('the grant row carries the booking reference, the exact wording, and the capture context', () => {
  const row = rowsFor('comm_contact_consents')[0]?.row
  assert.ok(row, 'a contact-level grant must be written')
  assert.equal(row.action, 'granted')
  assert.equal(row.channel, 'sms')
  assert.equal(row.appointment_id, 'appt-9', 'the booking/appointment reference is required evidence')
  assert.equal(row.contact_id, 'contact-9')
  assert.equal(row.consent_text, SMS_CONSENT.disclosure, 'the stored text must be the text shown')
  assert.ok(row.consent_version.startsWith(SMS_CONSENT.version), 'the version pins the deployed wording')
  assert.equal(row.captured_at, CAPTURE_INPUT.capturedAt)
  assert.equal(row.ip_address, '203.0.113.7')
  assert.equal(row.user_agent, 'Mozilla/5.0 (test)')
})
t('the stored key is the one the gate suffix-matches at send time', () => {
  const row = rowsFor('comm_contact_consents')[0].row
  assert.equal(row.contact, consentContactKey('sms', CAPTURE_INPUT.phone))
  assert.ok(row.contact.endsWith(smsTail(CAPTURE_INPUT.phone)))
})
t('the audit record reconstructs the booking the consent was captured at', () => {
  const a = audits.find((x) => x.action === 'consent.captured')
  assert.ok(a)
  assert.equal(a.diff.appointmentId, 'appt-9')
  assert.equal(a.diff.channel, 'sms')
  assert.equal(a.diff.granted, true)
  assert.equal(a.diff.phone_tail, '1234', 'only the last 4 digits reach the log')
  assert.ok(!JSON.stringify(a.diff).includes('5125551234'), 'the full number must not be logged')
})
t('a non-member booker gets NO member-scoped write at all', () => {
  assert.equal(capResult.memberGrant, 'not_a_member')
  assert.equal(rowsFor('comm_consent_purposes').length, 0)
})

const memberResult = await capture({ memberLink: { memberId: 'mem-1', householdId: 'hh-1', agencyId: null } })
t('an existing household member ALSO gets the purpose-scoped appointment grant', () => {
  // Without this the gate would ignore the contact-level grant entirely (it prefers the
  // member-keyed stores once a member resolves) and the client would never get their text.
  assert.equal(memberResult.memberGrant, 'granted')
  const row = rowsFor('comm_consent_purposes')[0]?.row
  assert.ok(row)
  assert.equal(row.purpose, 'APPOINTMENT_REMINDERS')
  assert.equal(row.status, 'granted')
  assert.equal(row.member_id, 'mem-1')
  assert.equal(row.source, 'booking_sms_optin')
})
t('the member grant is purpose-scoped only — no channel-wide consent is written', () => {
  assert.equal(rowsFor('consents').length, 0, 'a channel-wide grant would open the marketing lane too')
})

const revokedResult = await capture({
  memberLink: { memberId: 'mem-1', householdId: 'hh-1', agencyId: null },
  memberChannelStatus: 'revoked',
})
t('a prior STOP is NEVER undone by ticking the booking checkbox', () => {
  assert.equal(revokedResult.memberGrant, 'withheld_channel_revoked')
  assert.equal(rowsFor('comm_consent_purposes').length, 0)
})

// Deploy-order (ADR-039): the build can reach production before migration 135 is applied.
const preMigration = await capture({
  consentInsertError: { code: '42703', message: `column "appointment_id" of relation "comm_contact_consents" does not exist` },
})
t('a schema without the mig-135 columns still records the GRANT (degraded, never lost)', () => {
  // Losing the evidence linkage is bad; losing the grant means the booker silently gets no text
  // after explicitly asking for one, which is worse.
  assert.equal(preMigration.recorded, true, 'the consent grant must survive an unapplied migration')
  const rows = rowsFor('comm_contact_consents')
  assert.equal(rows.length, 2, 'one failed insert, then the degraded retry')
  assert.equal(rows[1].row.appointment_id, undefined, 'the retry drops only the mig-135 columns')
  assert.equal(rows[1].row.consent_text, SMS_CONSENT.disclosure, 'the evidence itself is unchanged')
  assert.equal(rows[1].row.contact, consentContactKey('sms', CAPTURE_INPUT.phone))
})

const hardFailure = await capture({ consentInsertError: { code: '23505', message: 'some other failure' } })
t('an UNRELATED insert failure is not retried, and is reported as no consent recorded', () => {
  assert.equal(hardFailure.recorded, false)
  assert.equal(rowsFor('comm_contact_consents').length, 1, 'no degraded retry on an unrelated error')
  const a = audits.find((x) => x.action === 'consent.captured')
  assert.equal(a.diff.granted, false, 'the audit must not claim a grant that was never stored')
})

t('the pure rule behind that decision', () => {
  assert.equal(mayGrantMemberAppointmentConsent('revoked'), false)
  assert.equal(mayGrantMemberAppointmentConsent('granted'), true)
  assert.equal(mayGrantMemberAppointmentConsent(null), true)
  assert.equal(mayGrantMemberAppointmentConsent(undefined), true)
})

Module._load = origLoad

console.log(`\nAll ${passed} assertions passed.`)
