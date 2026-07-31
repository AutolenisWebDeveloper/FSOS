// Cross-Sell Life Campaign — conversation timeout / ownership / intent proof (spec §13/§14).
// Compiles the PURE decision module (src/lib/cross-sell-life/conversation.ts) in isolation (no
// Supabase/clock) and asserts: low-confidence OR an escalation intent routes to the advisor while a
// confident green-zone intent does not; ownership flips to the advisor the moment escalation fires;
// and a one-reply-then-silent conversation times out to an abandoned close UNLESS it is escalated
// (the advisor's workflow then owns it — never auto-closed).
// Run: node tests/cross-sell-life-conversation.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-xsell-conversation-'))
execSync(
  `npx tsc src/lib/cross-sell-life/conversation.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  evaluateConversationTimeout,
  resolveOwner,
  decideIntent,
  ESCALATION_INTENTS,
  INTENT_LIBRARY,
} = require(join(out, 'conversation.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('decideIntent — confidence + escalation-intent gating (§13/§14)')

t('a low-confidence classification escalates (even for a green-zone intent)', () => {
  // "interested" is NOT an escalation intent, so escalation here is driven by low confidence alone.
  assert.equal(ESCALATION_INTENTS.has('interested'), false)
  const d = decideIntent('interested', 0.3, 0.7)
  assert.equal(d.lowConfidence, true)
  assert.equal(d.escalate, true)
})

t('an ESCALATION_INTENT escalates even at high confidence', () => {
  assert.equal(ESCALATION_INTENTS.has('quote'), true)
  const d = decideIntent('quote', 0.99, 0.7)
  assert.equal(d.lowConfidence, false)
  assert.equal(d.escalate, true)
})

t('a confident green-zone intent does NOT escalate', () => {
  const d = decideIntent('interested', 0.99, 0.7)
  assert.equal(d.lowConfidence, false)
  assert.equal(d.escalate, false)
})

t('confidence exactly at threshold is not "low" (strict <)', () => {
  const d = decideIntent('interested', 0.7, 0.7)
  assert.equal(d.lowConfidence, false)
  assert.equal(d.escalate, false)
})

t('every escalation intent is a member of the intent library', () => {
  for (const i of ESCALATION_INTENTS) {
    assert.ok(INTENT_LIBRARY.includes(i), `${i} must be in the intent library`)
  }
})

console.log('resolveOwner — one owner at a time (§14)')

t('an escalated conversation is owned by the advisor even before acceptance', () => {
  assert.equal(resolveOwner({ escalated: true, advisorAccepted: false }), 'advisor')
  assert.equal(resolveOwner({ escalated: true, advisorAccepted: true }), 'advisor')
})

t('a non-escalated conversation is owned by the AI', () => {
  assert.equal(resolveOwner({ escalated: false, advisorAccepted: false }), 'ai')
})

console.log('evaluateConversationTimeout — reply-then-silent → abandoned close')

t('past the timeout window with no advisor → close as abandoned', () => {
  const d = evaluateConversationTimeout({ minutesSinceLastReply: 200, timeoutHours: 2, escalatedToAdvisor: false })
  assert.equal(d.close, true)
  assert.equal(d.outcome, 'abandoned')
})

t('within the timeout window → no close', () => {
  const d = evaluateConversationTimeout({ minutesSinceLastReply: 60, timeoutHours: 2, escalatedToAdvisor: false })
  assert.equal(d.close, false)
  assert.equal(d.outcome, null)
})

t('an escalated conversation is NEVER auto-closed, however stale', () => {
  const d = evaluateConversationTimeout({ minutesSinceLastReply: 100000, timeoutHours: 1, escalatedToAdvisor: true })
  assert.equal(d.close, false)
  assert.equal(d.outcome, null)
})

t('no measured silence (null) → no close', () => {
  const d = evaluateConversationTimeout({ minutesSinceLastReply: null, timeoutHours: 2, escalatedToAdvisor: false })
  assert.equal(d.close, false)
  assert.equal(d.outcome, null)
})

console.log(`\nAll ${passed} assertions passed.`)
