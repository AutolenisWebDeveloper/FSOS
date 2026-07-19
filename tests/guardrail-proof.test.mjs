// Guardrail PROOF — the three guardrails actually block (CLAUDE.md §2,
// data-guardrails §3–5,7). Drives the REAL dispatcher (dispatch()) with injected
// spy side-effects to assert, for each blocked case: NOT sent, compliance_event
// recorded, escalation created, audit written (blocked, never silently dropped) —
// plus the positive case DOES send. Case 8 (forbidden deep link → 403) uses the
// real rbac decision. Case 7 (RLS column/row allowlist) is proved against a real
// Postgres in tests/rls-firewall.test.mjs.
//
// Emits a PASS/FAIL table with evidence. Run: node tests/guardrail-proof.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-proof-'))
execSync(
  `npx tsc src/lib/comms/dispatcher.ts src/lib/auth/rbac.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { dispatch } = require(join(out, 'comms/dispatcher.js'))
const { evaluateAccess } = require(join(out, 'auth/rbac.js'))

// ── Spy side-effects: record every call; sender returns success if reached. ──
function makeSpies() {
  const calls = { compliance: [], escalation: [], audit: [], send: [] }
  const deps = {
    recordComplianceEvent: async (req, gate) => { calls.compliance.push({ req, gate }) },
    createEscalation: async (req, gate) => { calls.escalation.push({ req, gate }) },
    writeAudit: async (entry) => { calls.audit.push(entry) },
    send: async (channel, to, body, subject) => { calls.send.push({ channel, to, body, subject }); return { ok: true, id: 'prov_1' } },
  }
  return { calls, deps }
}

const okGate = { hasConsent: true, recipientLocalHour: 12, onDNC: false, usesApprovedTemplateOrPolicy: true, isSecurity: false }
const baseReq = (over = {}) => ({
  channel: 'sms', to: '+15550100', body: 'Your review is tomorrow at 10am.',
  actor: 'agent:pipeline', entity: { type: 'household', id: 'h1' }, gate: { ...okGate }, ...over,
})

const results = []
async function blockedCase(id, name, req, expectStep, expectAuditAction) {
  const { calls, deps } = makeSpies()
  const r = await dispatch(req, deps)
  const evidence = []
  try {
    assert.equal(r.sent, false, 'must NOT send')
    evidence.push('sent=false')
    assert.equal(r.escalated, true, 'must escalate')
    assert.equal(r.gate.blockedStep, expectStep, `blockedStep=${expectStep}`)
    evidence.push(`blockedStep=${r.gate.blockedStep}`)
    assert.equal(calls.send.length, 0, 'sender never invoked')
    evidence.push('send.calls=0')
    // Case 9 — blocked, not silently dropped: compliance_event + escalation + audit.
    assert.equal(calls.compliance.length, 1, 'compliance_event recorded')
    assert.equal(calls.escalation.length, 1, 'escalation created')
    assert.equal(calls.audit.length, 1, 'audit written')
    assert.equal(calls.audit[0].action, expectAuditAction, `audit action=${expectAuditAction}`)
    evidence.push(`compliance_event+escalation+audit(${calls.audit[0].action}) written`)
    results.push({ id, name, pass: true, evidence: evidence.join(', ') })
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ id, name, pass: false, evidence: `${evidence.join(', ')} — FAILED: ${e.message}` })
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

console.log('Guardrail block proof (real dispatcher, spy side-effects)')

await blockedCase(1, 'AI recommendation language is BLOCKED (red line)',
  baseReq({ body: 'Honestly, you should buy the whole life policy — I recommend it.' }),
  'recommendation', 'comms.blocked')

await blockedCase(2, 'is_security recipient is BLOCKED (firewall)',
  baseReq({ gate: { ...okGate, isSecurity: true } }),
  'is_security', 'firewall.blocked')

await blockedCase(3, 'no valid channel consent is BLOCKED',
  baseReq({ gate: { ...okGate, hasConsent: false } }),
  'consent', 'comms.blocked')

await blockedCase(4, 'outside quiet hours (9–20 local) is BLOCKED',
  baseReq({ gate: { ...okGate, recipientLocalHour: 22 } }),
  'quiet_hours', 'comms.blocked')

await blockedCase(5, 'DNC / opted-out recipient is BLOCKED',
  baseReq({ gate: { ...okGate, onDNC: true } }),
  'dnc', 'comms.blocked')

await blockedCase(6, 'unapproved template is BLOCKED',
  baseReq({ gate: { ...okGate, usesApprovedTemplateOrPolicy: false } }),
  'approved_template', 'comms.blocked')

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
    const { calls, deps } = makeSpies()
    const r = await dispatch(baseReq({ body: 'You are invited to a complimentary review of your coverage. Reply to schedule.' }), deps)
    assert.equal(r.gate.allowed, true, 'gate allows')
    assert.equal(r.sent, true, 'sent=true')
    assert.equal(calls.send.length, 1, 'sender invoked once')
    assert.ok(calls.send[0].body.includes('Reply STOP'), 'SMS carries opt-out footer')
    assert.equal(calls.compliance.length, 0, 'no compliance_event')
    assert.equal(calls.escalation.length, 0, 'no escalation')
    assert.equal(calls.audit.length, 1, 'audit written')
    assert.equal(calls.audit[0].action, 'comms.sent', 'audit=comms.sent')
    evidence.push('gate=allowed', 'sent=true', 'send.calls=1', 'footer present', 'audit=comms.sent', 'no block/escalation')
    console.log('  ✓ consented/in-hours/approved/non-securities/non-recommendation → SENDS')
  } catch (e) { pass = false; evidence.push(`FAILED: ${e.message}`); console.log(`  ✗ ${e.message}`) }
  results.push({ id: 0, name: 'POSITIVE: compliant educational/invitation message sends', pass, evidence: evidence.join(', ') })
}

// ── PASS/FAIL table ──
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
