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
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Output INSIDE the repo so the compiled config-schemas.js resolves `zod` from the repo's
// node_modules (a /tmp outDir cannot). Cleaned up in the finally below.
const out = mkdtempSync(join(process.cwd(), 'node_modules', '.fsos-bk-sms-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))
execSync(
  `npx tsc src/lib/comms/contact-consent.ts src/lib/booking/config-schemas.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { consentContactKey, smsTail, latestConsentGranted } = require(join(out, 'comms/contact-consent.js'))
const { PublicBookingInput } = require(join(out, 'booking/config-schemas.js'))

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

console.log(`\nAll ${passed} assertions passed.`)
