// Campaign send-path fail-closed guardrails (docs/audit/outbound-campaigns-2026-08-07.md).
//
// Proves the two remediations of the 2026-08-07 outbound-campaigns audit stay in place:
//   1. usableTemplate(): an unloadable, channel-less, or empty-bodied template is NOT usable —
//      the three campaign-engine ticks fail closed on it instead of defaulting to an SMS with
//      a blank body (88 clients once received near-empty texts that way).
//   2. Static invariants: every engine tick guards with usableTemplate() BEFORE deriving the
//      channel, and sendThroughGate() no longer silently swallows a failed comm_messages
//      pre-insert — a send with no message-of-record is blocked + audited (§13.9), because a
//      silent FK dead-end once cost every campaign send its record.
//
// These are guardrail tests (§13.13): do not weaken or delete them to green a build.
//
// Run: node tests/campaign-send-fail-closed.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('campaign send-path fail-closed guardrails\n')

// ── 1. usableTemplate() pure predicate ─────────────────────────────────────────
const out = mkdtempSync(join(tmpdir(), 'fsos-usable-template-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch {} })

execSync(
  `npx tsc src/lib/comms/usable-template.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --strict`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
// Single-entry compile → tsc roots the output at the entry file's own directory.
const { usableTemplate } = require(join(out, 'usable-template.js'))

t('null / undefined template (failed fetch) is NOT usable', () => {
  assert.equal(usableTemplate(null), false)
  assert.equal(usableTemplate(undefined), false)
})

t('template with no channel is NOT usable (never default to SMS)', () => {
  assert.equal(usableTemplate({ channel: null, body: 'Hello there' }), false)
  assert.equal(usableTemplate({ body: 'Hello there' }), false)
  assert.equal(usableTemplate({ channel: '', body: 'Hello there' }), false)
})

t('template with an empty or whitespace-only body is NOT usable (never send a blank message)', () => {
  assert.equal(usableTemplate({ channel: 'sms', body: '' }), false)
  assert.equal(usableTemplate({ channel: 'sms', body: '   \n\t ' }), false)
  assert.equal(usableTemplate({ channel: 'email', body: null }), false)
})

t('a loaded template with a channel and a real body IS usable', () => {
  assert.equal(usableTemplate({ channel: 'email', body: 'Subject: Hi\n\nBody' }), true)
  assert.equal(usableTemplate({ channel: 'sms', body: 'Quick note about your review.' }), true)
})

// ── 2. Static invariants on the send path ──────────────────────────────────────
const TICKS = [
  'src/lib/life-campaign/tick.ts',
  'src/lib/cross-sell-life/tick.ts',
  'src/lib/pipeline-winback/tick.ts',
]

for (const file of TICKS) {
  const src = readFileSync(file, 'utf8')
  t(`${file} fails closed via usableTemplate() before deriving the channel`, () => {
    const guardAt = src.indexOf('if (!usableTemplate(tpl))')
    assert.ok(guardAt > -1, 'missing usableTemplate() guard')
    assert.ok(src.includes("'template_load_failed'"), 'missing template_load_failed execution mark')
    // The guard must run BEFORE the channel derivation that once defaulted to SMS.
    const channelAt = src.indexOf("tpl.channel === 'email' ? 'email' : 'sms'", guardAt)
    assert.ok(channelAt > guardAt, 'channel derivation must come after the guard')
    // The unguarded optional-chained fallback must not drive the send channel anymore
    // (the A2P pre-check's read-only peek is allowed; it never sends).
    const sendPath = src.slice(guardAt)
    assert.ok(
      !sendPath.includes("tpl?.channel === 'email' ? 'email' : 'sms'"),
      'send path must not derive a channel from a possibly-null template',
    )
  })
}

const sendSrc = readFileSync('src/lib/comms/send.ts', 'utf8')

t('sendThroughGate blocks the send when the message-of-record cannot be written', () => {
  assert.ok(
    !sendSrc.includes('best-effort; dispatcher still writes the durable audit'),
    'the silent pre-insert swallow must not return',
  )
  assert.ok(sendSrc.includes("blockedStep: 'message_record'"), 'missing message_record block step')
  const blockAt = sendSrc.indexOf('if (!messageId) {')
  assert.ok(blockAt > -1, 'missing fail-closed messageId check')
  const blockBody = sendSrc.slice(blockAt, sendSrc.indexOf('const emailReady', blockAt))
  assert.ok(blockBody.includes('sent: false'), 'record failure must not send')
  assert.ok(blockBody.includes('blocked: true'), 'record failure must report blocked')
  assert.ok(blockBody.includes('writeAudit'), 'record failure must be audited')
})

t('the comm_messages pre-insert surfaces its error instead of discarding it', () => {
  assert.ok(sendSrc.includes('messageRecordError'), 'insert error must be captured for the audit trail')
})

console.log(`\nAll ${passed} assertions passed.`)
