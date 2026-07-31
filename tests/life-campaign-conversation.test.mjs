// Life Conversion Campaign — conversation timeout + ownership handoff (pure). §13b: a client
// who replies once then goes silent must not pin the campaign paused forever — a configurable
// timeout closes the conversation as abandoned and hands back to the recalculated schedule.
// §13c: once escalated to an advisor, the AI is read-only and the timeout clock belongs to the
// advisor — the campaign must not auto-resume out from under an advisor still working the lead.
// Run: node tests/life-campaign-conversation.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-lcc-conv-'))
execSync(
  `npx tsc src/lib/life-campaign/conversation.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateConversationTimeout, resolveOwner, COMPLIANCE_SENSITIVE_INTENTS } = require(join(out, 'conversation.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('evaluateConversationTimeout — §13b')

t('a client silent past the timeout closes the conversation as abandoned', () => {
  const r = evaluateConversationTimeout({ minutesSinceLastReply: 60 * 60, timeoutHours: 48, escalatedToAdvisor: false })
  assert.equal(r.close, true)
  assert.equal(r.outcome, 'abandoned')
})

t('within the timeout window the conversation stays open', () => {
  const r = evaluateConversationTimeout({ minutesSinceLastReply: 60, timeoutHours: 48, escalatedToAdvisor: false })
  assert.equal(r.close, false)
})

t('an escalated conversation never auto-closes — the advisor owns the clock (§13c)', () => {
  const r = evaluateConversationTimeout({ minutesSinceLastReply: 60 * 600, timeoutHours: 48, escalatedToAdvisor: true })
  assert.equal(r.close, false)
})

console.log('resolveOwner — §13c handoff')

t('AI owns an un-escalated conversation', () => {
  assert.equal(resolveOwner({ escalated: false, advisorAccepted: false }), 'ai')
})

t('once escalated and accepted, the advisor owns it (AI read-only)', () => {
  assert.equal(resolveOwner({ escalated: true, advisorAccepted: true }), 'advisor')
})

t('escalated but not yet accepted still routes to advisor (AI must not answer meanwhile)', () => {
  assert.equal(resolveOwner({ escalated: true, advisorAccepted: false }), 'advisor')
})

console.log('compliance-sensitive intents route to escalation (§6a/§10)')

t('the compliance-sensitive intents are declared and include cost/eligibility/medical/timing', () => {
  for (const i of ['existing_coverage', 'cost_concern', 'eligibility_question', 'medical_question', 'timing_deadline', 'advisor_request', 'unknown'])
    assert.ok(COMPLIANCE_SENSITIVE_INTENTS.includes(i), `missing ${i}`)
})

console.log(`\n✓ life-campaign conversation: ${passed} assertions passed`)
