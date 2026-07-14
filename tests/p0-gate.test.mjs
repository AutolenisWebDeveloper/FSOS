// P0 gate proof — the system-functional acceptance guarantees that can be proven
// from pure cores without a live Supabase (acceptance-checklist §2):
//   • the securities firewall blocks any substantive securities write on the spine
//     (opportunity/policy/convert payloads) — FSOS stays a non-record system;
//   • the 7-step comms gate hard-blocks an is_security recipient — no is_security
//     record can ever be sent to;
//   • the referral→conversion contract is idempotent by construction (a required
//     idempotency_key) and rejects an incomplete conversion.
// The full Agency→Referral→Household→Opportunity flow with audit at each step is
// exercised by the API routes (src/app/api/referrals/[id]/convert/route.ts et al.),
// which write audit_log on every mutation; those require a live DB and are covered
// by integration runs. This file proves the guardrail invariants the flow depends on.
// Run: node tests/p0-gate.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Compile INTO the project tree (not /tmp) so the emitted schemas.js can resolve
// its `zod` import via the project's node_modules. Cleaned up at the end.
const out = mkdtempSync(join(process.cwd(), '.p0-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort cleanup */
  }
})
execSync(
  `npx tsc src/lib/comms/gate.ts src/lib/compliance/firewall.ts src/lib/validation/schemas.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateGate } = require(join(out, 'comms/gate.js'))
const { assertNotSecuritiesSystemOfRecord, findForbiddenSecuritiesFields } = require(join(out, 'compliance/firewall.js'))
const { ReferralConvertSchema, OpportunityStageSchema } = require(join(out, 'validation/schemas.js'))

const results = []
function check(name, fn, evidence) {
  try {
    fn()
    results.push({ pass: true, name, evidence: evidence() })
  } catch (e) {
    results.push({ pass: false, name, evidence: e.message })
  }
}

// 1 — Firewall blocks substantive securities data on any spine write.
check(
  'Securities firewall blocks account/order/suitability fields on a spine payload',
  () => {
    for (const bad of [
      { household_id: 'x', securities_account_number: '123' },
      { product_id: 'p', order_id: 'o-1' },
      { suitability_determination: 'suitable' },
    ]) {
      assert.throws(() => assertNotSecuritiesSystemOfRecord(bad), /firewall/i)
    }
    // The only allowed securities reference is a non-substantive pointer.
    assert.equal(findForbiddenSecuritiesFields({ ffs_case_ref: 'FFS-123' }).length, 0)
  },
  () => 'account/order/suitability payloads throw FirewallError; ffs_case_ref pointer allowed',
)

// 2 — No is_security record can be SENT to (7-step gate, step 6).
check(
  'is_security recipient is hard-blocked by the comms gate (never sent)',
  () => {
    const r = evaluateGate({
      draft: 'A neutral educational note.',
      channel: 'sms',
      hasConsent: true,
      recipientLocalHour: 12,
      onDNC: false,
      usesApprovedTemplateOrPolicy: true,
      isSecurity: true,
    })
    assert.equal(r.allowed, false)
    assert.equal(r.blockedStep, 'is_security')
    assert.equal(r.escalate, true)
  },
  () => 'gate.allowed=false, blockedStep=is_security, escalate=true',
)

// 3 — Conversion is idempotent by contract and rejects an incomplete conversion.
check(
  'Referral conversion requires an idempotency key and complete minimum fields',
  () => {
    const complete = {
      primary_name: 'Smith Household',
      member_full_name: 'Jane Smith',
      engagement: 'warm_handoff',
      idempotency_key: 'conv-abcdef12',
    }
    assert.equal(ReferralConvertSchema.safeParse(complete).success, true)
    // Missing idempotency key → rejected (no unguarded retry path).
    const { idempotency_key, ...noKey } = complete
    assert.equal(ReferralConvertSchema.safeParse(noKey).success, false)
    // Missing member/household name → rejected.
    assert.equal(ReferralConvertSchema.safeParse({ engagement: 'direct', idempotency_key: 'conv-abcdef12' }).success, false)
  },
  () => 'valid conversion passes; missing idempotency_key or names rejected',
)

// 4 — Opportunity stage transitions are constrained to the defined pipeline.
check(
  'Opportunity stage schema only accepts defined pipeline stages',
  () => {
    assert.equal(OpportunityStageSchema.safeParse({ stage: 'placed_issued' }).success, true)
    assert.equal(OpportunityStageSchema.safeParse({ stage: 'not_a_stage' }).success, false)
  },
  () => 'placed_issued accepted; unknown stage rejected',
)

// ── Report ────────────────────────────────────────────────────────────────────
const width = 84
console.log('\n' + '─'.repeat(width))
console.log('P0 GATE — securities firewall + comms gate + conversion idempotency')
console.log('─'.repeat(width))
for (const [i, r] of results.entries()) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${i} | ${r.name}`)
  console.log(`        └─ ${r.evidence}`)
}
console.log('─'.repeat(width))
const failed = results.filter((r) => !r.pass)
if (failed.length) {
  console.error(`\n${failed.length} P0 gate proof(s) FAILED.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} P0 gate proofs passed.`)
