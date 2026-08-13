// Message-of-record fail-closed — static wiring invariants
// (docs/audit/outbound-campaigns-2026-08-07.md, Finding 1 / main-audit F-1).
//
// The behavioral proofs live in tests/comms-message-of-record-failclosed.test.mjs (real
// sendThroughGate + spy dispatcher: a failed pre-insert withholds the send) and
// tests/campaign-template-failclosed.test.mjs (engine ticks skip unusable templates without
// dispatching). THIS file pins the source-level wiring those proofs assume, so a refactor
// cannot quietly reintroduce the silent-swallow shape while the behavioral mocks still pass:
//   • the comm_messages pre-insert error is captured, never discarded;
//   • a missing message-of-record blocks the send, is audited (comms.blocked /
//     message_of_record), and escalates to the human-FSA queue (agent_actions);
//   • the engine ticks keep their granular fail-closed template validation.
//
// These are guardrail tests (§13.13): do not weaken or delete them to green a build.
//
// Run: node tests/campaign-send-fail-closed.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('message-of-record fail-closed — static wiring invariants\n')

const sendSrc = readFileSync('src/lib/comms/send.ts', 'utf8')

t('the comm_messages pre-insert error is captured, never silently discarded', () => {
  assert.ok(
    !sendSrc.includes('best-effort; dispatcher still writes the durable audit'),
    'the silent pre-insert swallow must not return',
  )
  assert.ok(sendSrc.includes('messageOfRecordError'), 'insert error must be captured')
})

t('a missing message-of-record blocks the send and is audited', () => {
  assert.ok(sendSrc.includes("blockedStep: 'message_of_record'"), 'missing message_of_record block step')
  const blockAt = sendSrc.indexOf('if (!messageId) {')
  assert.ok(blockAt > -1, 'missing fail-closed messageId check')
  const blockBody = sendSrc.slice(blockAt, sendSrc.indexOf('const emailReady', blockAt))
  assert.ok(blockBody.includes('sent: false'), 'record failure must not send')
  assert.ok(blockBody.includes('blocked: true'), 'record failure must report blocked')
  assert.ok(blockBody.includes('writeAudit'), 'record failure must be audited')
})

t('a withheld send escalates to the human-FSA queue (agent_actions)', () => {
  const blockAt = sendSrc.indexOf('if (!messageId) {')
  const blockBody = sendSrc.slice(blockAt, sendSrc.indexOf('const emailReady', blockAt))
  assert.ok(blockBody.includes("kind: 'escalation'"), 'missing agent_actions escalation')
  assert.ok(blockBody.includes('message_of_record_write_failed'), 'missing escalation reason')
})

const TICKS = [
  'src/lib/life-campaign/tick.ts',
  'src/lib/cross-sell-life/tick.ts',
  'src/lib/pipeline-winback/tick.ts',
]

for (const file of TICKS) {
  const src = readFileSync(file, 'utf8')
  t(`${file} keeps the granular fail-closed template validation`, () => {
    for (const marker of ['template_unresolved', 'template_channel_invalid', 'template_body_empty']) {
      assert.ok(src.includes(`'${marker}'`), `missing ${marker} skip reason`)
    }
    // The blank-SMS default must never return: a possibly-null template may not choose the channel.
    assert.ok(
      !src.includes("const channel = (tpl?.channel === 'email' ? 'email' : 'sms')"),
      'send channel must not be derived from a possibly-null template',
    )
  })
}

console.log(`\nAll ${passed} assertions passed.`)
