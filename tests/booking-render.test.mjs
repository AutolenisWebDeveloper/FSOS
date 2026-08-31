// D1 proof — the RENDERED booking email body (not the context object).
// The prior booking-notify test only asserted the merge-CONTEXT object, so the fact that
// personalize() silently blanked appointment_time / meeting_details / reschedule_url /
// cancel_url shipped to production undetected. This test compiles the REAL render engine
// (src/lib/comms/personalize.ts) and the REAL booking context builder
// (src/lib/booking/notify-core.ts), renders the actual appointment template lines, and
// asserts the delivered body carries the formatted time, the meeting details, and the
// ABSOLUTE manage URLs — and that a missing blocking token is detected as unresolved
// (fail closed) rather than rendered empty.
// Run: node tests/booking-render.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-booking-render-'))
execSync(
  `npx tsc src/lib/comms/personalize.ts src/lib/booking/notify-core.ts src/lib/booking/sms-templates.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { personalize, unresolvedBlockingTokens } = require(join(out, 'comms/personalize.js'))
const { buildBookingContext } = require(join(out, 'booking/notify-core.js'))
const { BOOKING_SMS_TEMPLATES } = require(join(out, 'booking/sms-templates.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// The exact merge-token-bearing lines rendered by the confirmation/reminder template
// (src/emails/appointments.tsx). Kept in lock-step with the source via the guard below.
const CONFIRMATION_BODY = [
  `<h1>You're all set, {{first_name}}</h1>`,
  `<p><strong>When:</strong> {{appointment_time}}</p>`,
  `<p>{{meeting_details}}</p>`,
  `<p>Need to make a change? Reschedule: {{reschedule_url}} — or cancel: {{cancel_url}}</p>`,
].join('\n')

t('appointments.tsx still renders the four booking merge tokens (fixture guard)', () => {
  const src = readFileSync('src/emails/appointments.tsx', 'utf8')
  for (const tok of ['{{appointment_time}}', '{{meeting_details}}', '{{reschedule_url}}', '{{cancel_url}}']) {
    assert.ok(src.includes(tok), `appointments.tsx no longer references ${tok} — update this fixture`)
  }
})

const ABS = 'https://www.markistfsa.com'
const ctx = {
  ...buildBookingContext({
    fullName: 'Dana Rivers',
    startsAt: '2026-08-03T14:00:00Z', // 9:00 AM CDT
    bookerTimezone: 'America/Chicago',
    meetingMode: 'video',
    joinUrl: 'https://zoom.us/j/9',
  }),
  reschedule_url: `${ABS}/schedule?manage=resc-token`,
  cancel_url: `${ABS}/schedule?manage=canc-token`,
}

t('rendered confirmation body carries the formatted appointment time (not an empty "When:")', () => {
  const body = personalize(CONFIRMATION_BODY, ctx, { escapeHtml: true })
  assert.doesNotMatch(body, /\{\{/, 'a raw {{token}} leaked into the delivered body')
  assert.match(body, /When:<\/strong>\s*Monday, August 3, 2026/)
  assert.match(body, /9:00\s?AM/)
  assert.match(body, /CDT/)
  // The specific bug: the "When:" line must never render blank.
  assert.doesNotMatch(body, /When:<\/strong>\s*<\/p>/)
})

t('rendered body carries the meeting details (join link)', () => {
  const body = personalize(CONFIRMATION_BODY, ctx, { escapeHtml: true })
  assert.match(body, /zoom\.us\/j\/9/)
})

t('rendered body carries BOTH absolute manage URLs', () => {
  const body = personalize(CONFIRMATION_BODY, ctx, { escapeHtml: true })
  assert.match(body, /Reschedule:\s*https:\/\/www\.markistfsa\.com\/schedule\?manage=resc-token/)
  assert.match(body, /cancel:\s*https:\/\/www\.markistfsa\.com\/schedule\?manage=canc-token/)
  // Never the pre-fix broken sentence.
  assert.doesNotMatch(body, /Reschedule:\s*—/)
})

t('a missing blocking token is detected as UNRESOLVED (fail closed), not rendered empty', () => {
  const missing = unresolvedBlockingTokens(CONFIRMATION_BODY, { first_name: 'Dana' })
  for (const tok of ['appointment_time', 'meeting_details', 'reschedule_url', 'cancel_url']) {
    assert.ok(missing.includes(tok), `expected ${tok} to be flagged unresolved`)
  }
})

t('a RELATIVE manage URL is treated as unresolved (absolute-URL enforcement)', () => {
  const missing = unresolvedBlockingTokens('{{reschedule_url}}', { reschedule_url: '/schedule?manage=x' })
  assert.ok(missing.includes('reschedule_url'), 'a relative URL must be flagged unresolved')
})

t('a fully-resolved booking body reports NO unresolved blocking tokens', () => {
  const missing = unresolvedBlockingTokens(CONFIRMATION_BODY, ctx)
  assert.deepEqual(missing, [], `unexpected unresolved tokens: ${missing.join(', ')}`)
})

// ── The SMS bodies, through the SAME render engine ───────────────────────────
// The email half of this file exists because personalize() silently blanked booking tokens in
// production. The SMS bodies carry the same tokens and have LESS margin for error: an SMS has no
// subject or layout to carry meaning, so a blanked {{appointment_time}} leaves a text that says
// "You're confirmed for ." — and unlike email, an SMS leg has no transactional fallback behind it.
const SMS_CTX = {
  ...ctx,
  agency_name: 'Markist Athelus — Farmers Insurance',
  scheduling_link: `${ABS}/schedule`,
}

for (const tpl of BOOKING_SMS_TEMPLATES) {
  t(`[${tpl.sourceKey}] renders with no raw token and no blank slot`, () => {
    const body = personalize(tpl.body, SMS_CTX)
    assert.doesNotMatch(body, /\{\{/, 'a raw {{token}} leaked into the delivered SMS')
    // The failure mode this guards: a token that resolves to '' leaves stranded punctuation.
    assert.doesNotMatch(body, /\s[.,]/, `blank merge value left stranded punctuation: ${body}`)
    assert.doesNotMatch(body, /:\s*(Reply|$)/, `an empty link slot was rendered: ${body}`)
  })
  t(`[${tpl.sourceKey}] reports NO unresolved blocking tokens when fully supplied`, () => {
    assert.deepEqual(unresolvedBlockingTokens(tpl.body, SMS_CTX), [])
  })
}

t('the confirmation SMS states the actual appointment time and an absolute manage link', () => {
  const tpl = BOOKING_SMS_TEMPLATES.find((x) => x.sourceKey === 'appointment-confirmation-sms')
  const body = personalize(tpl.body, SMS_CTX)
  assert.match(body, /Monday, August 3, 2026/)
  assert.match(body, /9:00\s?AM/)
  assert.match(body, /https:\/\/www\.markistfsa\.com\/schedule\?manage=resc-token/)
  assert.match(body, /Reply STOP to opt out/)
})

t('the reminder SMS announces the SAME grounded time (a reschedule moves it, not the copy)', () => {
  const tpl = BOOKING_SMS_TEMPLATES.find((x) => x.sourceKey === 'appointment-reminder-sms')
  const moved = {
    ...SMS_CTX,
    ...buildBookingContext({
      fullName: 'Dana Rivers',
      startsAt: '2026-08-05T20:00:00Z', // 3:00 PM CDT — the NEW time after a reschedule
      bookerTimezone: 'America/Chicago',
      meetingMode: 'video',
      joinUrl: 'https://zoom.us/j/9',
    }),
  }
  const body = personalize(tpl.body, moved)
  assert.match(body, /Wednesday, August 5, 2026/)
  assert.match(body, /3:00\s?PM/)
  assert.doesNotMatch(body, /August 3/, 'the reminder must never announce the pre-reschedule time')
})

t('an appointment with NO reschedule token fails closed rather than texting a broken link', () => {
  // notify.ts renders reschedule_url as '' for an appointment carrying no self-service token
  // (e.g. one created from a review). A blocking token must be reported, not shipped empty.
  const tpl = BOOKING_SMS_TEMPLATES.find((x) => x.sourceKey === 'appointment-confirmation-sms')
  const missing = unresolvedBlockingTokens(tpl.body, { ...SMS_CTX, reschedule_url: '' })
  assert.ok(missing.includes('reschedule_url'))
})

console.log(`\n✓ booking render: ${passed} assertions passed`)
