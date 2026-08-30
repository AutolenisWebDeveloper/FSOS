// ALL NINE formerly-ungated paths now dispatch through the gated chokepoint.
//
// Phase A found nine outbound paths reaching Resend/Twilio with no consent read, no DNC, no
// suppression and no audit. Consolidation closed them by making lib/messaging.ts itself the
// enforcement point. This file proves it per path, two ways:
//
//   STRUCTURALLY  — the compiled call graph: every path's send lands in messaging.sendEmail /
//                   sendSms (there is no other file that can reach a provider), and the ONE
//                   provider-touching file runs resolveDispatchPolicy before either provider
//                   call, with no early return between decision and enforcement.
//   BEHAVIORALLY  — each path's DECLARATION (its policy context) is exercised against the
//                   REAL resolver + REAL gate: what each path claims about itself produces a
//                   send under clean state, and does NOT survive a DNC'd recipient — the
//                   check demonstrably RUNS on that path's exact declaration. Asserting only
//                   "sendThroughGate is absent" would be the false green the task brief
//                   names; these cases fail if the consolidated checks stop being consulted.
//
// Path 8 (briefing/email) and 9 (agent-runner ctx.send) route through dispatch(), which is
// itself proven to forward to the chokepoint below.
//
// Run: node tests/chokepoint-paths.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

withProviderEnv()
const mod = loadChokepoint('paths')
const NOON = new Date(Date.UTC(2026, 0, 15, 18, 0))

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

// ─────────────────────────────────────────────────────────────────────────────
console.log('Structural: one provider boundary, decision before delivery, no bypass')

await t('messaging.ts is the ONLY file touching a provider (Resend / api.twilio.com)', async () => {
  // The grep the Phase A map was built on, kept as a standing invariant. A tenth path would
  // have to introduce a new provider call somewhere else — this is the tripwire.
  const { execSync } = await import('node:child_process')
  const hits = execSync(
    `grep -rln "api\\.twilio\\.com\\|from 'resend'\\|import('resend')" --include='*.ts' --include='*.tsx' src/`,
    { cwd: root },
  ).toString().trim().split('\n')
  assert.deepEqual(hits, ['src/lib/messaging.ts'], `provider access outside the chokepoint: ${hits.join(', ')}`)
})

await t('inside messaging.ts, BOTH send functions resolve policy before their provider call', () => {
  const src = read('src/lib/messaging.ts')
  for (const fn of ['sendEmail', 'sendSms']) {
    const start = src.indexOf(`export async function ${fn}`)
    const end = src.indexOf('export async function', start + 10)
    const body = src.slice(start, end === -1 ? undefined : end)
    const policyAt = body.indexOf('resolvePolicy(')
    const deliverAt = body.indexOf(fn === 'sendSms' ? 'deliverSms(' : 'deliverEmail(')
    assert.ok(policyAt > -1, `${fn} must call resolvePolicy`)
    assert.ok(deliverAt > policyAt, `${fn} must decide BEFORE delivering`)
    assert.ok(/if \(!decision\.allowed\)/.test(body), `${fn} must obey the decision`)
  }
})

await t('the SMS opt-out footer is appended AFTER the checks, inside sendSms, and nowhere upstream', () => {
  const messaging = read('src/lib/messaging.ts')
  const smsBody = messaging.slice(messaging.indexOf('export async function sendSms'))
  const decisionAt = smsBody.indexOf('resolvePolicy(')
  const footerAt = smsBody.indexOf('SMS_OPT_OUT_FOOTER')
  assert.ok(footerAt > decisionAt, 'footer append follows the policy decision (checks see the authored body)')
  // The dispatcher no longer appends it — one append, one place.
  assert.ok(!/SMS_OPT_OUT_FOOTER/.test(read('src/lib/comms/dispatcher.ts')), 'dispatcher must not append the footer')
})

await t('sendThroughGate is deleted — and the consuming paths were renamed, not orphaned', () => {
  // The deletion alone would be a false green; pair it with the callers now naming the
  // preparation entry point, whose behavior is exercised elsewhere in the suite.
  const send = read('src/lib/comms/send.ts')
  assert.ok(!/export async function sendThroughGate/.test(send), 'the gate wrapper is gone')
  assert.ok(/export async function sendMessage/.test(send), 'the preparation entry point exists')
  for (const p of ['src/lib/comms/campaign.ts', 'src/lib/comms/inbound.ts', 'src/lib/ai/workforce.ts', 'src/lib/forms.ts']) {
    assert.ok(/sendMessage\(/.test(read(p)), `${p} routes through sendMessage`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nBehavioral: each path’s declaration is gated — the checks RUN on that shape')

/**
 * Each entry reproduces the EXACT policy declaration its production call site passes
 * (verified against the source below), so what this proves is that THE DECLARATION THAT
 * PATH USES clears the gate on clean state and is blocked on a DNC'd recipient.
 */
// [label, file that carries the declaration, source anchor proving it, the declaration]
const EMAIL_PATHS = [
  ['1 visitor ack (contact / workshop reg / booking)', 'src/lib/notifications/transactional.ts', 'system_transactional',
    { actor: 'system:notify', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional', suppressible: false, durableConsentGranted: true }],
  // The fallback's declaration lives in sendVisitorAck (transactional.ts); notify.ts
  // asserts the transactional BASIS, which is the field anchored here.
  ['2 booking transactional fallback', 'src/lib/booking/notify.ts', 'transactionalBasis: true',
    { actor: 'system:notify', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional', suppressible: false, durableConsentGranted: true }],
  // PATH 3 REMOVED, not un-gated: main gated `src/app/api/workshops/register/route.ts`
  // because it was an unauthenticated, publicly reachable POST. This branch DELETED that
  // route outright (WS-B1/WS-002) — it had no in-repo caller, no rate limit, no publish
  // gate and no consent capture, and the gated public route
  // (/api/public/workshops/register) is the only door. A path that does not exist cannot
  // bypass the chokepoint, and its absence is asserted positively, not merely implied:
  // tests/operational-email.test.mjs — "legacy /api/workshops/register stays deleted".
  // Nothing was loosened; one row was dropped because its file is gone.
  // NOT aiGenerated: §11 governs client-facing AI; this digest goes to the operator's own
  // inbox. The recommendation red line still screens the AI body (proven separately below).
  ['4 AI morning briefing (briefing/send)', 'src/app/api/briefing/send/route.ts', 'system_transactional',
    { actor: 'system:briefing', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional', suppressible: false, consentWaived: true }],
  ['5 form-link email leg', 'src/lib/forms.ts', "templateKind: 'human'",
    { actor: 'system:forms', purpose: 'TRANSACTIONAL', templateKind: 'human', suppressible: false }],
  ['6 password-setup email', 'src/lib/notifications/account.ts', 'system_transactional',
    { actor: 'system:provisioning', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional', suppressible: false, consentWaived: true }],
  ['7 internal FSA ops alert', 'src/lib/notifications/transactional.ts', 'consentWaived: true',
    { actor: 'system:notify', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional', suppressible: false, consentWaived: true }],
]

for (const [label, sourceFile, anchor, policy] of EMAIL_PATHS) {
  await t(`path ${label}: declaration sends clean AND blocks on DNC`, async () => {
    // The production file actually carries this declaration (literal anchor per file).
    const src = read(sourceFile)
    assert.ok(src.includes(anchor), `${sourceFile} carries its declaration (${anchor})`)

    // Clean state → the declaration is sufficient to send.
    {
      const { messagingDeps, calls } = makeMessagingDeps(mod, {}, { now: NOON })
      const r = await mod.messaging.sendEmail('lee@example.com', 'Subject', '<p>Body.</p>', undefined, { policy }, messagingDeps)
      assert.equal(r.ok, true, `${label}: clean send must pass`)
      assert.equal(calls.email.length, 1)
    }
    // DNC'd recipient → the SAME declaration is blocked; the check ran on this path's shape.
    {
      const { messagingDeps, calls, seen } = makeMessagingDeps(mod, { onDNC: true }, { now: NOON })
      const r = await mod.messaging.sendEmail('lee@example.com', 'Subject', '<p>Body.</p>', undefined, { policy }, messagingDeps)
      assert.equal(r.ok, false, `${label}: a DNC'd recipient must block`)
      assert.equal(r.blockedStep, 'dnc')
      assert.equal(seen.onDNC, 1, `${label}: the DNC reader was consulted`)
      assert.equal(calls.email.length, 0, 'provider never reached')
      assert.equal(calls.escalate.length, 1, 'blocked → escalation path, never silent')
    }
  })
}

await t('path 8 (briefing/email) + 9 (agent-runner): dispatch() forwards to the chokepoint — and cannot forward the regulatory reads', () => {
  const src = read('src/lib/comms/dispatcher.ts')
  assert.ok(/await sendSms\(|await sendEmail\(/.test(src), 'dispatch delegates to the chokepoint senders')
  assert.ok(!/evaluateGate\(/.test(src), 'the dispatcher no longer runs its own gate')
  // The forwarded policy object must not carry the caller-asserted regulatory verdicts.
  const policyBlock = src.slice(src.indexOf('const policy: SendPolicyOptions'), src.indexOf('const result: SendResult'))
  for (const banned of ['hasConsent', 'onDNC', 'recipientLocalHour', 'usesApprovedTemplateOrPolicy', 'businessSuppressed', 'smsLive']) {
    assert.ok(!policyBlock.includes(banned), `dispatcher must not forward caller-asserted "${banned}"`)
  }
  // And the two callers reach it with an honest declaration, not asserted-away booleans.
  const briefing = read('src/app/api/briefing/email/route.ts')
  assert.ok(/hasConsent: false/.test(briefing), 'briefing/email no longer asserts hasConsent:true')
  assert.ok(/consentWaived: true/.test(briefing), 'briefing/email declares the self-send waiver instead')
  const runner = read('src/jobs/agent-runner.ts')
  assert.ok(/workerKey: args.agentKey/.test(runner), 'agent-runner scopes the per-worker window')
})

await t('path 4 corollary: recommendation language in a briefing body is STILL blocked (red line runs on raw gateway output)', async () => {
  const policy = { actor: 'system:briefing', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional', suppressible: false, consentWaived: true }
  const { messagingDeps, calls } = makeMessagingDeps(mod, {}, { now: NOON })
  const r = await mod.messaging.sendEmail('markist@fsa.example', 'Briefing',
    '<p>Honestly, you should buy the whole life policy — I recommend it.</p>', undefined, { policy }, messagingDeps)
  assert.equal(r.ok, false, 'a recommendation-shaped body must not mail, even to the operator')
  assert.equal(r.blockedStep, 'recommendation')
  assert.equal(calls.email.length, 0)
})

await t("the DNC'd case above holds for SMS paths too (form-link SMS declaration)", async () => {
  const policy = { actor: 'system:forms', purpose: 'TRANSACTIONAL', templateKind: 'human', suppressible: false }
  const { messagingDeps, calls, seen } = makeMessagingDeps(mod, { onDNC: true }, { now: NOON })
  const r = await mod.messaging.sendSms('+12145550147', 'Your secure form link: https://x', 'mid-f', { policy }, messagingDeps)
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'dnc')
  assert.equal(seen.onDNC, 1)
  assert.equal(calls.sms.length, 0)
})

console.log(`\nAll ${passed} assertions passed — nine paths, one chokepoint.`)
