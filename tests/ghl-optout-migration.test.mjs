// D0 PROOF — a migrated GHL opt-out actually BLOCKS a send through evaluateGate.
// "A row existing in a table proves nothing" (ADR-014 D0): this test plans the
// opt-out with the pure planner, derives the send-time gate inputs the way send.ts
// would, and asserts the REAL evaluateGate blocks the send. Covers:
//   • member-resolved  → consents revoked → blocked at step 1 (consent)
//   • fail-closed (no member, has phone) → dnc_entries → blocked at step 3 (dnc),
//     even when consent is (adversarially) still granted — proves fail-closed works
//   • email-only opt-out does not suppress SMS (channel normalization)
//   • unresolved (no member, no contact) is detected (D0 exit criterion = zero)
//   • consent_ledger is NEVER a write target; original timestamps preserved
// Mirrors tests/guardrail.test.mjs' compile-and-require harness (no live DB).
// Run: node tests/ghl-optout-migration.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-ghl-optout-'))
// gate.ts → guardrail.ts (pure); the planner is standalone/pure. Compile all three.
execSync(
  `npx tsc src/lib/comms/gate.ts src/lib/compliance/guardrail.ts src/lib/comms/migration/ghl-optout.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateGate } = require(join(out, 'comms/gate.js'))
const { planOptOut, normalizeOptOutChannels, planEnforcesChannel } = require(
  join(out, 'comms/migration/ghl-optout.js'),
)

const results = []
function record(id, name, fn) {
  try { fn(); results.push({ id, pass: true }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ id, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) }
}

// Build a gate input where EVERYTHING passes except what the opt-out changes, so a
// block can only come from the migrated suppression (consent or dnc), never noise.
function gateInput(channel, { hasConsent, onDNC }) {
  return {
    draft: 'Hello from your Farmers Financial Services team.', // no recommendation language
    channel,
    hasConsent,
    recipientLocalHour: 12,          // inside 9–20 quiet-hours floor
    withinBusinessHours: true,
    onDNC,
    usesApprovedTemplateOrPolicy: true,
    isSecurity: false,
    otherRuleBlocked: false,
  }
}

// Derive send.ts-style gate inputs from a plan for one channel + recipient contact.
function deriveInputs(plan, channel, contact, priorConsentGranted) {
  const revoked = plan.writes.some((w) => w.target === 'consents' && w.channel === channel && w.status === 'revoked')
  const onDNC = plan.writes.some((w) => w.target === 'dnc_entries' && w.channel === channel && w.contact === contact)
  // send.ts hasConsent = a consents row is 'granted'. A migration revoke makes it false;
  // if the migration did NOT touch consents (fail-closed), it reflects prior state.
  const hasConsent = revoked ? false : !!priorConsentGranted
  return gateInput(channel, { hasConsent, onDNC })
}

// ── 1. Member-resolved SMS opt-out → consents revoked → gate blocks at 'consent' ──
record('D0-1', 'member-resolved opt-out blocks the send (consent revoked)', () => {
  const rec = { ghl_contact_id: 'ghl_1', phone: '+14695550111', channel: 'sms', opted_out_at: '2025-02-03T10:00:00Z' }
  const plan = planOptOut(rec, { member_id: 'm1', household_id: 'h1' })
  assert.equal(plan.unresolved, false)
  assert.ok(planEnforcesChannel(plan, 'sms'))
  const res = evaluateGate(deriveInputs(plan, 'sms', '+14695550111', true))
  assert.equal(res.allowed, false, 'send must be blocked')
  assert.equal(res.blockedStep, 'consent')
})

// ── 2. FAIL-CLOSED: no member, has phone → dnc_entries → blocks at 'dnc' even if
//        consent is (adversarially) still granted. The key fail-closed proof. ──
record('D0-2', 'fail-closed opt-out (no member) still blocks via dnc_entries', () => {
  const rec = { ghl_contact_id: 'ghl_2', phone: '+14695550222', channel: 'sms', opted_out_at: '2025-02-04T11:00:00Z' }
  const plan = planOptOut(rec, null) // member unresolved
  assert.equal(plan.unresolved, false, 'a phone is present → enforceable via dnc_entries')
  assert.ok(plan.writes.some((w) => w.target === 'dnc_entries'))
  assert.ok(!plan.writes.some((w) => w.target === 'consents'), 'no member → no consents write')
  // Adversarial: pretend the contact still has SMS consent granted. DNC must still block.
  const res = evaluateGate(deriveInputs(plan, 'sms', '+14695550222', true))
  assert.equal(res.allowed, false, 'fail-closed dnc_entries must block regardless of consent')
  assert.equal(res.blockedStep, 'dnc')
})

// ── 3. Email-only opt-out does NOT suppress SMS ──
record('D0-3', 'email-only opt-out leaves SMS un-suppressed', () => {
  assert.deepEqual(normalizeOptOutChannels('email'), ['email'])
  const rec = { email: 'a@b.com', phone: '+14695550333', channel: 'email', opted_out_at: '2025-02-05T12:00:00Z' }
  const plan = planOptOut(rec, { member_id: 'm3', household_id: 'h3' })
  assert.ok(planEnforcesChannel(plan, 'email'))
  assert.equal(planEnforcesChannel(plan, 'sms'), false, 'SMS must remain reachable')
  // The SMS channel has no migrated suppression → a consented SMS send is allowed.
  const res = evaluateGate(gateInput('sms', { hasConsent: true, onDNC: false }))
  assert.equal(res.allowed, true)
})

// ── 4. Ambiguous channel (dnd/all/empty) suppresses BOTH channels ──
record('D0-4', 'ambiguous channel token opts out of both sms and email', () => {
  for (const tok of ['all', 'both', '', 'dnd', 'weird']) {
    assert.deepEqual(normalizeOptOutChannels(tok), ['sms', 'email'], `token=${tok}`)
  }
  const rec = { email: 'c@d.com', phone: '+14695550444', channel: 'all', opted_out_at: '2025-02-06T09:00:00Z' }
  const plan = planOptOut(rec, { member_id: 'm4', household_id: 'h4' })
  assert.ok(planEnforcesChannel(plan, 'sms') && planEnforcesChannel(plan, 'email'))
})

// ── 5. Unresolved (no member, no contact value) is detected → D0 exit criterion ──
record('D0-5', 'unresolved opt-out (no member, no contact) is flagged', () => {
  const rec = { ghl_contact_id: 'ghl_5', channel: 'sms', opted_out_at: '2025-02-07T09:00:00Z' } // no phone/email
  const plan = planOptOut(rec, null)
  assert.equal(plan.unresolved, true, 'must be flagged so the reconciliation report can require zero')
  assert.equal(plan.writes.length, 0)
})

// ── 6. consent_ledger is NEVER a target; original timestamps preserved ──
record('D0-6', 'never writes consent_ledger; preserves original GHL timestamps', () => {
  const rec = { email: 'e@f.com', phone: '+14695550666', channel: 'all', opted_out_at: '2024-12-31T23:59:00Z' }
  const plan = planOptOut(rec, { member_id: 'm6', household_id: 'h6' })
  for (const w of plan.writes) {
    assert.ok(w.target === 'dnc_entries' || w.target === 'consents', `unexpected target ${w.target}`)
    const ts = w.target === 'dnc_entries' ? w.created_at : w.captured_at
    assert.equal(ts, '2024-12-31T23:59:00Z', 'timestamp must be preserved, never now()')
    assert.ok(('reason' in w ? w.reason : w.source) === 'ghl_migration')
  }
})

const failed = results.filter((r) => !r.pass)
console.log(`\nD0 opt-out migration: ${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.error('FAILED:', failed.map((f) => f.id).join(', ')); process.exit(1) }
