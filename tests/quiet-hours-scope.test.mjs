// Quiet-hours scope (owner-directed, 2026-08-07) — proves the PURE cores offline,
// mirroring tests/guardrail.test.mjs / tests/comms-policy.test.mjs:
//
//   1. The 9:00–20:00 recipient-local floor applies to SMS MARKETING/CAMPAIGN sends
//      only (purpose.ts quietHoursApply): email is never gated; transactional/
//      servicing-class SMS is not gated; an SMS with NO purpose (the campaign path)
//      stays gated. The floor itself is UNCHANGED — 9:00–20:00, not widened.
//   2. The gate's quietHoursExempt flag relaxes ONLY step 2 — consent, DNC,
//      recommendation red-line, and the securities firewall still block.
//   3. The human-authored live-conversation window is exactly 24h (both sides of
//      the boundary), fail-closed on missing/garbage input.
//   4. Recipient-local hour resolves DST-correctly from an IANA timezone
//      (America/Chicago default) — an August (CDT, UTC-5) timestamp must NOT get
//      the old hardcoded CST -6 answer.
//
// Run: node tests/quiet-hours-scope.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-quiet-'))
execSync(
  `npx tsc src/lib/comms/purpose.ts src/lib/comms/gate.ts src/lib/comms/local-time.ts ` +
    `src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { quietHoursApply, QUIET_HOURS_GATED_PURPOSES, MESSAGE_PURPOSES } = require(join(out, 'comms/purpose.js'))
const { evaluateGate } = require(join(out, 'comms/gate.js'))
const { localHourInTimeZone, withinLiveConversationWindow, LIVE_CONVERSATION_WINDOW_MS, DEFAULT_TIMEZONE } = require(
  join(out, 'comms/local-time.js'),
)

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// A gate context that passes every step except what each test overrides.
const okCtx = {
  hasConsent: true,
  recipientLocalHour: 12,
  onDNC: false,
  usesApprovedTemplateOrPolicy: true,
  isSecurity: false,
}

console.log('Quiet-hours scope (purpose.ts quietHoursApply)')

t('email is never quiet-hours gated — any purpose, or none', () => {
  assert.equal(quietHoursApply('email'), false)
  assert.equal(quietHoursApply('email', null), false)
  for (const p of MESSAGE_PURPOSES) assert.equal(quietHoursApply('email', p), false, `email/${p}`)
})

t('SMS marketing-class purposes ARE gated: MARKETING, WORKSHOP, BIRTHDAY, RELATIONSHIP', () => {
  assert.deepEqual([...QUIET_HOURS_GATED_PURPOSES].sort(), ['BIRTHDAY', 'MARKETING', 'RELATIONSHIP', 'WORKSHOP'])
  for (const p of QUIET_HOURS_GATED_PURPOSES) assert.equal(quietHoursApply('sms', p), true, `sms/${p}`)
})

t('SMS transactional/servicing-class purposes are NOT gated', () => {
  for (const p of ['TRANSACTIONAL', 'APPOINTMENT', 'SERVICING', 'APPLICATION_STATUS', 'DOCUMENT_REQUEST', 'POLICY_DEADLINE']) {
    assert.equal(quietHoursApply('sms', p), false, `sms/${p}`)
  }
})

t('SMS with NO purpose (unclassified campaign path) stays gated', () => {
  assert.equal(quietHoursApply('sms'), true)
  assert.equal(quietHoursApply('sms', null), true)
  assert.equal(quietHoursApply('sms', undefined), true)
})

console.log('Gate step 2 with the exemption flag')

t('default (no flag): off-hours send blocks on quiet_hours and escalates — unchanged', () => {
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, recipientLocalHour: 22 })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'quiet_hours')
  assert.equal(r.escalate, true)
})

t('the 9:00–20:00 floor itself is unchanged (not widened): 8 blocks, 9 passes, 19 passes, 20 blocks', () => {
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, recipientLocalHour: 8 }).blockedStep, 'quiet_hours')
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, recipientLocalHour: 9 }).allowed, true)
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, recipientLocalHour: 19 }).allowed, true)
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, recipientLocalHour: 20 }).blockedStep, 'quiet_hours')
})

t('quietHoursExempt: an off-hours exempt send passes step 2 and sends', () => {
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, recipientLocalHour: 22, quietHoursExempt: true })
  assert.equal(r.allowed, true)
})

t('the exemption relaxes ONLY step 2 — consent, DNC, red-line, and firewall still block', () => {
  const off = { draft: 'hi', channel: 'sms', ...okCtx, recipientLocalHour: 22, quietHoursExempt: true }
  assert.equal(evaluateGate({ ...off, hasConsent: false }).blockedStep, 'consent')
  assert.equal(evaluateGate({ ...off, onDNC: true }).blockedStep, 'dnc')
  assert.equal(evaluateGate({ ...off, usesApprovedTemplateOrPolicy: false }).blockedStep, 'approved_template')
  const rec = evaluateGate({ ...off, draft: 'You should buy this policy today' })
  assert.equal(rec.blockedStep, 'recommendation')
  assert.equal(rec.escalate, true)
  assert.equal(evaluateGate({ ...off, isSecurity: true }).blockedStep, 'is_security')
})

console.log('Human-authored live-conversation window (24h boundary)')

t('inbound 23h59m ago → inside the window (exempt side of the boundary)', () => {
  const now = new Date('2026-08-07T12:00:00Z')
  const inbound = new Date(now.getTime() - (LIVE_CONVERSATION_WINDOW_MS - 60_000))
  assert.equal(withinLiveConversationWindow(inbound.toISOString(), now), true)
})

t('inbound 24h01m ago → OUTSIDE the window (send falls through and stays gated)', () => {
  const now = new Date('2026-08-07T12:00:00Z')
  const inbound = new Date(now.getTime() - (LIVE_CONVERSATION_WINDOW_MS + 60_000))
  assert.equal(withinLiveConversationWindow(inbound.toISOString(), now), false)
})

t('window fails closed: no inbound, null, or garbage timestamp → not exempt', () => {
  assert.equal(withinLiveConversationWindow(null), false)
  assert.equal(withinLiveConversationWindow(undefined), false)
  assert.equal(withinLiveConversationWindow('not-a-date'), false)
})

console.log('IANA recipient-local hour (DST-correct)')

t('August timestamp resolves CDT (UTC-5), not the old hardcoded CST -6', () => {
  // 2026-08-07 18:30 UTC = 13:30 CDT. The old fixed -6 computed 12 — the DST bug.
  const at = new Date('2026-08-07T18:30:00Z')
  const h = localHourInTimeZone('America/Chicago', at)
  assert.equal(h, 13)
  assert.notEqual(h, (at.getUTCHours() - 6 + 24) % 24)
})

t('January timestamp resolves CST (UTC-6)', () => {
  assert.equal(localHourInTimeZone('America/Chicago', new Date('2026-01-15T18:30:00Z')), 12)
})

t('invalid timezone falls back to the default zone; default is America/Chicago', () => {
  const at = new Date('2026-08-07T18:30:00Z')
  assert.equal(DEFAULT_TIMEZONE, 'America/Chicago')
  assert.equal(localHourInTimeZone('Not/AZone', at), localHourInTimeZone('America/Chicago', at))
  // §11a repair: 0-23 was the function's whole output range. Pin the no-arg default
  // against an INDEPENDENT Intl computation of the America/Chicago hour right now.
  const expectHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  const now = localHourInTimeZone()
  assert.equal(now, expectHour, 'no-arg call must resolve the current hour in the default America/Chicago zone')
})

console.log(`\nAll ${passed} assertions passed.`)
