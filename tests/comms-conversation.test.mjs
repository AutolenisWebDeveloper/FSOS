// Slice 4 — Conversation mode (§10). Proves the PURE resume decision offline, mirroring
// tests/guardrail.test.mjs. The pause-on-reply → drip-skip → no "haven't heard back"
// behavior is structural (inbound sets PAUSED_FOR_CONVERSATION; the drip runner only
// advances status='enrolled'); this covers the resume gate. Run: node tests/comms-conversation.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-conv-'))
execSync(
  `npx tsc src/lib/comms/conversation-mode.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateResume, shouldPauseOnReply } = require(join(out, 'conversation-mode.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const base = { conversationStatus: 'open', minutesSinceLastInbound: 60, resumeQuietDays: 5 }

console.log('evaluateResume — automation resumes ONLY per §10')

t('an open conversation with a recent reply stays PAUSED (no "haven\'t heard back")', () => {
  const r = evaluateResume(base)
  assert.equal(r.resume, false)
  assert.match(r.reason, /still active/i)
})

t('a resolved conversation resumes', () => {
  assert.equal(evaluateResume({ ...base, conversationStatus: 'resolved' }).resume, true)
  assert.equal(evaluateResume({ ...base, conversationStatus: 'closed' }).resume, true)
})

t('a customer quiet for ≥ the configured period resumes', () => {
  // quiet 5 days (7200 min) with a 5-day window → resume.
  assert.equal(evaluateResume({ ...base, minutesSinceLastInbound: 5 * 24 * 60 }).resume, true)
  // quiet 4 days < 5-day window → still paused.
  assert.equal(evaluateResume({ ...base, minutesSinceLastInbound: 4 * 24 * 60 }).resume, false)
})

t('an authorized manual resume overrides an open, recent conversation', () => {
  const r = evaluateResume({ ...base, manualResume: true })
  assert.equal(r.resume, true)
  assert.match(r.reason, /resumed/i)
})

t('null last-inbound (no reply since pause) does not trigger the quiet-period resume', () => {
  const r = evaluateResume({ ...base, minutesSinceLastInbound: null })
  assert.equal(r.resume, false)
})

console.log('shouldPauseOnReply — every genuine reply pauses; bare keywords do not')

t('a genuine reply pauses promotional automation', () => {
  assert.equal(shouldPauseOnReply(false), true)
})

t('a bare keyword-only inbound (STOP/HELP/START) is not treated as a conversation pause', () => {
  assert.equal(shouldPauseOnReply(true), false)
})

console.log(`\nAll ${passed} conversation-mode assertions passed.`)
