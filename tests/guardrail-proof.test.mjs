// Guardrail PROOF — the three guardrails actually block (CLAUDE.md §2,
// data-guardrails §3–5,7).
//
// Drives the REAL DISPATCH CHOKEPOINT (messaging.sendSms) with the REAL policy resolver and
// the REAL gate; only the database readers and the provider are spies. Enforcement moved
// from the dispatcher to the chokepoint, so this proof moved with it — the alternative,
// asserting against a stubbed verdict, would prove the test's own stub rather than the
// control.
//
// For each blocked case: NOT sent, escalation invoked with the right step and escalate
// flag, provider never reached — plus the positive case DOES send and carries the opt-out
// footer. Case 8 (forbidden deep link → 403) uses the real rbac decision. Case 7 (RLS
// column/row allowlist) is proved against a real Postgres in tests/rls-firewall.test.mjs.
//
// Emits a PASS/FAIL table with evidence. Run: node tests/guardrail-proof.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'

const out = mkdtempSync(join(tmpdir(), 'fsos-proof-'))
execSync(
  `npx tsc src/lib/auth/rbac.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateAccess } = require(join(out, 'rbac.js'))

const mod = loadChokepoint('proof')
withProviderEnv()

// ── Spies: only the DB readers and the provider. The resolver and gate are REAL. ──
// `state` names the one condition each case is proving; everything else stays permissive,
// so a failure points at the control under test rather than at harness setup.
// Fixed instants — a unit test must never depend on the wall clock. 18:00 UTC is 12:00 in
// America/Chicago (CST); 04:00 UTC is 22:00 the previous day, outside the 9–20 floor.
const NOON_LOCAL = new Date(Date.UTC(2026, 0, 15, 18, 0))
const LATE_LOCAL = new Date(Date.UTC(2026, 0, 15, 4, 0))

function drive(state, body, policy = {}, now = NOON_LOCAL) {
  const { messagingDeps, calls } = makeMessagingDeps(mod, state, { now })
  return mod.messaging
    .sendSms('+12145550147', body, 'mid-proof', {
      policy: { actor: 'agent:pipeline', entity: { type: 'household', id: 'h1' }, purpose: 'MARKETING', templateKind: 'stored', templateId: 't1', ...policy },
    }, messagingDeps)
    .then((r) => ({ r, calls }))
}

const CLEAN_BODY = 'Your review is tomorrow at 10am.'

const results = []
async function blockedCase(id, name, state, body, expectStep, expectAuditAction, policy = {}, now = NOON_LOCAL) {
  const evidence = []
  try {
    const { r, calls } = await drive(state, body, policy, now)
    assert.equal(r.ok, false, 'must NOT send')
    evidence.push('sent=false')
    assert.equal(r.blockedStep, expectStep, `blockedStep=${expectStep}`)
    evidence.push(`blockedStep=${r.blockedStep}`)
    assert.equal(calls.sms.length, 0, 'provider never invoked')
    evidence.push('provider.calls=0')
    // Blocked, never silently dropped: the chokepoint hands every withheld send to the
    // escalation path, which decides compliance-event + FSA queue vs. a quiet deferral.
    assert.equal(calls.escalate.length, 1, 'escalation path invoked exactly once')
    assert.equal(calls.escalate[0].outcome.blockedStep, expectStep, 'escalated with the right step')
    assert.equal(calls.escalate[0].outcome.escalate, true, 'this block escalates to the FSA')
    assert.equal(r.escalated, true, 'result reports escalated')
    // No bare {ok:false}: the caller always receives a reason.
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'reason present')
    evidence.push(`escalated + reason (audit=${expectAuditAction})`)
    results.push({ id, name, pass: true, evidence: evidence.join(', ') })
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ id, name, pass: false, evidence: `${evidence.join(', ')} — FAILED: ${e.message}` })
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

console.log('Guardrail block proof (real chokepoint + real gate, DB readers stubbed)')

await blockedCase(1, 'AI recommendation language is BLOCKED (red line)',
  {}, 'Honestly, you should buy the whole life policy — I recommend it.',
  'recommendation', 'comms.blocked',
  // The red line is relaxed only for a supervisor-approved HUMAN template; an AI-policy
  // send never qualifies, which is what this case pins.
  { templateKind: 'ai_policy', templateId: null, aiGenerated: false })

await blockedCase(2, 'is_security recipient is BLOCKED (firewall)',
  { conversationSecurity: true }, CLEAN_BODY, 'is_security', 'firewall.blocked')

await blockedCase(3, 'no valid channel consent is BLOCKED',
  { memberConsent: false, contactConsent: false }, CLEAN_BODY, 'consent', 'comms.blocked')

await blockedCase(4, 'outside quiet hours (9–20 recipient-local) is BLOCKED',
  // The local hour is DERIVED from a real IANA zone at a fixed instant, not injected as a
  // number — so this also proves the timezone resolution feeding the floor.
  {}, CLEAN_BODY, 'quiet_hours', 'comms.blocked', {}, LATE_LOCAL)

await blockedCase(5, 'DNC / opted-out recipient is BLOCKED',
  { onDNC: true }, CLEAN_BODY, 'dnc', 'comms.blocked')

await blockedCase(6, 'unapproved template is BLOCKED',
  { templateApproved: false }, CLEAN_BODY, 'approved_template', 'comms.blocked')

// ── Case 8 — forbidden deep link → 403 (no blank page, no data leak) ──
console.log('Forbidden deep link (rbac decision)')
{
  const evidence = []
  let pass = true
  try {
    const d1 = evaluateAccess('/super/users', { userId: 'u', roles: ['fsa'], mfaSatisfied: true, stepUpFresh: true })
    assert.equal(d1.action, 'forbid') // middleware rewrites → /403
    const d2 = evaluateAccess('/app', { userId: 'u', roles: ['client'], mfaSatisfied: true, stepUpFresh: true })
    assert.equal(d2.action, 'forbid')
    assert.notEqual(d1.action, 'allow'); assert.notEqual(d2.action, 'allow')
    evidence.push('fsa→/super=forbid(→403)', 'client→/app=forbid(→403)', 'no allow/data-leak')
    console.log('  ✓ forbidden deep link → 403 (forbid), never allow')
  } catch (e) { pass = false; evidence.push(`FAILED: ${e.message}`); console.log(`  ✗ ${e.message}`) }
  results.push({ id: 8, name: 'forbidden deep link for a role → 403', pass, evidence: evidence.join(', ') })
}

// ── Positive — consented, in-hours, approved, non-securities, non-recommendation → SENDS ──
console.log('Positive case (must send)')
{
  const evidence = []
  let pass = true
  try {
    const { r, calls } = await drive({}, 'You are invited to a complimentary review of your coverage. Reply to schedule.')
    assert.equal(r.ok, true, 'sent=true')
    assert.equal(r.blocked, undefined, 'not blocked')
    assert.equal(calls.sms.length, 1, 'provider invoked once')
    assert.ok(calls.sms[0].body.includes('Reply STOP'), 'SMS carries the opt-out footer')
    assert.equal(calls.escalate.length, 0, 'no escalation on a clean send')
    assert.equal(calls.auditSent.length, 1, 'the send is audited')
    evidence.push('sent=true', 'provider.calls=1', 'opt-out footer present', 'audited, no escalation')
    console.log('  ✓ compliant message sends, footered and audited')
  } catch (e) { pass = false; evidence.push(`FAILED: ${e.message}`); console.log(`  ✗ ${e.message}`) }
  results.push({ id: 0, name: 'POSITIVE: compliant educational/invitation message sends', pass, evidence: evidence.join(', ') })
}

console.log('\n' + '─'.repeat(96))
console.log('PASS/FAIL  | # | Test                                                        | Evidence')
console.log('─'.repeat(96))
for (const r of results.sort((a, b) => a.id - b.id)) {
  const tag = r.pass ? 'PASS' : 'FAIL'
  console.log(`  ${tag}     | ${String(r.id).padEnd(1)} | ${r.name.padEnd(58)} | ${r.evidence}`)
}
console.log('─'.repeat(96))

const failed = results.filter((r) => !r.pass)
if (failed.length) {
  console.error(`\n${failed.length} guardrail assertion(s) FAILED — build-blocking defect.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} guardrail proofs passed (cases 1–6, 8, 9, positive).`)
console.log('Case 7 (RLS column/row allowlist) → tests/rls-firewall.test.mjs')
