// Pipeline Win-Back Campaign — conversation intent taxonomy (pure). Proves the §9 intent library,
// the red-line escalation set (§4.2: no AI substantive product/premium/suitability answer), and
// the §10 exit-outcome mapping (Future Follow-Up is a workflow outcome, not a dead end — §0.12).
// Run: node tests/pipeline-winback-conversation.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-pwb-conv-'))
execSync(
  `npx tsc src/lib/pipeline-winback/conversation.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { WINBACK_INTENTS, requiresAdvisorEscalation, exitOutcomeForIntent } = require(join(out, 'conversation.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('WINBACK_INTENTS — the §9 library')

t('includes the full §9 intent set', () => {
  for (const i of ['interested', 'appointment', 'quote', 'application', 'coverage_question', 'budget', 'existing_coverage', 'need_more_time', 'purchased_elsewhere', 'not_interested', 'stop', 'help', 'unknown']) {
    assert.ok(WINBACK_INTENTS.includes(i), `missing intent ${i}`)
  }
})

console.log('requiresAdvisorEscalation — the §4.2 red-line')

t('escalates substantive/individualized intents and unknowns', () => {
  for (const i of ['quote', 'application', 'coverage_question', 'budget', 'existing_coverage', 'unknown']) {
    assert.equal(requiresAdvisorEscalation(i), true, `${i} should escalate`)
  }
})

t('does not escalate a plain scheduling/interest reply', () => {
  assert.equal(requiresAdvisorEscalation('appointment'), false)
  assert.equal(requiresAdvisorEscalation('interested'), false)
})

console.log('exitOutcomeForIntent — §10 state machine exits')

t('maps terminal intents to their exit outcomes', () => {
  assert.equal(exitOutcomeForIntent('appointment'), 'appointment')
  assert.equal(exitOutcomeForIntent('quote'), 'quote')
  assert.equal(exitOutcomeForIntent('application'), 'application')
  assert.equal(exitOutcomeForIntent('purchased_elsewhere'), 'purchased_elsewhere')
  assert.equal(exitOutcomeForIntent('not_interested'), 'not_interested')
  assert.equal(exitOutcomeForIntent('stop'), 'stop')
})

t('need_more_time exits to the Future Follow-Up workflow, not a dead end (§0.12)', () => {
  assert.equal(exitOutcomeForIntent('need_more_time'), 'future_follow_up')
})

t('a non-terminal intent has no exit', () => {
  assert.equal(exitOutcomeForIntent('interested'), null)
  assert.equal(exitOutcomeForIntent('coverage_question'), null)
})

console.log(`\n✓ pipeline-winback conversation: ${passed} assertions passed`)
