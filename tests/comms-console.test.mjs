// Communications Command Console — PURE policy proofs (spec §0/§5/§6/§9/§12). Mirrors the
// other comms pure-core tests (comms-policy, comms-ai-authority): compile the pure source
// with tsc, require the JS, assert offline (no DB). Run: node tests/comms-console.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-console-'))
execSync(
  `npx tsc src/lib/comms/console.ts src/lib/comms/purpose.ts src/lib/comms/ai-authority.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  MANUAL_SEND_PURPOSES,
  isManualPurposeAllowed,
  openerClassFor,
  canInitiateAiConversation,
  isSendableKind,
  channelForKind,
  isTestRecipientUsable,
  normalizeTestAddress,
  isValidTestAddress,
  smsSegmentInfo,
  makeVerificationCode,
} = require(join(out, 'console.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Manual 1:1 send purposes (§12.1)')

t('WORKSHOP and BIRTHDAY are NOT available for a 1:1 send; servicing/marketing are', () => {
  assert.equal(isManualPurposeAllowed('WORKSHOP'), false)
  assert.equal(isManualPurposeAllowed('BIRTHDAY'), false)
  assert.equal(isManualPurposeAllowed('SERVICING'), true)
  assert.equal(isManualPurposeAllowed('MARKETING'), true)
  assert.equal(isManualPurposeAllowed('APPOINTMENT'), true)
  assert.equal(isManualPurposeAllowed(null), false)
  assert.equal(isManualPurposeAllowed('NONSENSE'), false)
  assert.ok(MANUAL_SEND_PURPOSES.length >= 6)
})

console.log('AI conversation opener class (§12.2)')

t('seeded-from-approved-template → first touch; blank → availability question; both auto-send', () => {
  assert.equal(openerClassFor('approved_template'), 'approved_first_touch')
  assert.equal(openerClassFor('blank'), 'availability_question')
})

console.log('AI initiation eligibility (§4.1/§7)')

t('a securities-flagged contact can NEVER get AI initiation (firewall)', () => {
  const r = canInitiateAiConversation({ isSecurity: true, agentEnabled: true, isGuardrail: false })
  assert.equal(r.allowed, false)
  assert.match(r.reason, /firewall|[Ss]ecurities/)
})

t('the guardrail agent is not a conversational starter', () => {
  const r = canInitiateAiConversation({ isSecurity: false, agentEnabled: true, isGuardrail: true })
  assert.equal(r.allowed, false)
})

t('a disabled agent cannot be armed', () => {
  const r = canInitiateAiConversation({ isSecurity: false, agentEnabled: false, isGuardrail: false })
  assert.equal(r.allowed, false)
})

t('an enabled, non-guardrail agent on a non-securities contact is allowed', () => {
  const r = canInitiateAiConversation({ isSecurity: false, agentEnabled: true, isGuardrail: false })
  assert.equal(r.allowed, true)
})

console.log('Catalog sendability (§3.4)')

t('advisor_outreach is never sendable; email/sms/ai_conversation are', () => {
  assert.equal(isSendableKind('advisor_outreach'), false)
  assert.equal(isSendableKind('email'), true)
  assert.equal(isSendableKind('sms'), true)
  assert.equal(isSendableKind('ai_conversation'), true)
  assert.equal(channelForKind('sms'), 'sms')
  assert.equal(channelForKind('email'), 'email')
  assert.equal(channelForKind('ai_conversation'), null)
})

console.log('Test-recipient allowlist (§6)')

t('a test recipient is usable ONLY when verified AND owned by the actor', () => {
  const verifiedMine = { user_id: 'u1', verified_at: '2026-01-01T00:00:00Z' }
  const unverifiedMine = { user_id: 'u1', verified_at: null }
  const verifiedOther = { user_id: 'u2', verified_at: '2026-01-01T00:00:00Z' }
  assert.equal(isTestRecipientUsable(verifiedMine, 'u1'), true)
  assert.equal(isTestRecipientUsable(unverifiedMine, 'u1'), false)
  assert.equal(isTestRecipientUsable(verifiedOther, 'u1'), false)
  assert.equal(isTestRecipientUsable(null, 'u1'), false)
})

t('address normalization + validation for both channels', () => {
  assert.equal(normalizeTestAddress('sms', '(214) 555-1234'), '2145551234')
  assert.equal(normalizeTestAddress('sms', '+1 214 555 1234'), '+12145551234')
  assert.equal(normalizeTestAddress('email', '  Me@Example.COM '), 'me@example.com')
  assert.equal(isValidTestAddress('email', 'me@example.com'), true)
  assert.equal(isValidTestAddress('email', 'not-an-email'), false)
  assert.equal(isValidTestAddress('sms', '2145551234'), true)
  assert.equal(isValidTestAddress('sms', '12345'), false)
})

console.log('SMS segment estimate (preview)')

t('short GSM body is one segment; >160 GSM chars split; unicode shortens the budget', () => {
  const short = smsSegmentInfo('Hello there')
  assert.equal(short.encoding, 'GSM-7')
  assert.equal(short.segments, 1)
  const long = smsSegmentInfo('a'.repeat(200))
  assert.equal(long.encoding, 'GSM-7')
  assert.equal(long.segments, 2)
  const uni = smsSegmentInfo('emoji 😀 here')
  assert.equal(uni.encoding, 'UCS-2')
  // §11a repair: segments >= 1 was true for the function's whole output range. Pin the
  // exact UCS-2 budget: 13 UTF-16 units → 1 segment; 71 units → 2 (the 70/67 split).
  assert.equal(uni.segments, 1)
  const uniLong = smsSegmentInfo('😀' + 'a'.repeat(69))   // 2 + 69 = 71 UTF-16 units
  assert.equal(uniLong.encoding, 'UCS-2')
  assert.equal(uniLong.segments, 2)
})

console.log('Verification code')

t('code is a zero-padded 6-digit string; rand is injectable', () => {
  assert.equal(makeVerificationCode(0), '000000')
  assert.equal(makeVerificationCode(0.123456), '123456')
  assert.match(makeVerificationCode(), /^\d{6}$/)
})

console.log(`\n✅ comms-console: ${passed} passed`)
