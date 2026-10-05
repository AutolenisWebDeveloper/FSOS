// Follow-up R9: a blocked password-setup email must never leave its live recovery link in the
// escalation queue (agent_actions.drafted_content, shown at /app/ai/escalations/[id]). A send that
// declares containsCredential records a redaction marker instead of the body, at the chokepoint.
// Run: node tests/credential-email-redaction.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'

withProviderEnv()
const mod = loadChokepoint('credential-redaction')
const LINK = 'https://fsos.test/auth/recover?token=SECRET-RECOVERY-TOKEN'
const HTML = `<p>Set your password: <a href="${LINK}">${LINK}</a></p>`

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('A blocked credential email is escalated without its body')
await t('a DNC-blocked password-setup email escalates with the body redacted', async () => {
  const { messagingDeps, calls } = makeMessagingDeps(mod, { onDNC: true })
  const policy = { actor: 'system:provisioning', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional', suppressible: false, consentWaived: true, containsCredential: true }
  const r = await mod.messaging.sendEmail('new.user@example.com', 'Set your password', HTML, `Set your password: ${LINK}`, { policy }, messagingDeps)
  assert.equal(r.ok, false)
  assert.equal(calls.escalate.length, 1)
  const stored = calls.escalate[0].ctx.body
  assert.ok(!stored.includes('SECRET-RECOVERY-TOKEN'), 'the live recovery link reached the escalation record')
  assert.match(stored, /redacted/i, 'the record says it was redacted')
})
await t('an ordinary blocked email still escalates with its body (nothing else changes)', async () => {
  const { messagingDeps, calls } = makeMessagingDeps(mod, { onDNC: true })
  await mod.messaging.sendEmail('client@example.com', 'Hello', '<p>Ordinary body</p>', 'Ordinary body', { policy: { actor: 'x', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional' } }, messagingDeps)
  assert.match(calls.escalate[0].ctx.body, /Ordinary body/)
})
await t('the password-setup sender declares containsCredential', () => {
  assert.match(readFileSync('src/lib/notifications/account.ts', 'utf8'), /containsCredential: true/)
})
console.log(`\nAll ${passed} assertions passed.`)
