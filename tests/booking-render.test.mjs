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
  `npx tsc src/lib/comms/personalize.ts src/lib/booking/notify-core.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { personalize, unresolvedBlockingTokens } = require(join(out, 'comms/personalize.js'))
const { buildBookingContext } = require(join(out, 'booking/notify-core.js'))

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

console.log(`\n✓ booking render: ${passed} assertions passed`)
