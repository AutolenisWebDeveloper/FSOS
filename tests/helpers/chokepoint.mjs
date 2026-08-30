// tests/helpers/chokepoint.mjs
// Shared harness for exercising the DISPATCH CHOKEPOINT (src/lib/messaging.ts) offline.
//
// NOT a test file — it lives under tests/helpers/ so scripts/run-tests.mjs (which reads
// tests/ at depth 0 only) does not pick it up as a suite.
//
// WHAT IT STUBS, AND WHAT IT DELIBERATELY DOES NOT. Only the DATABASE READERS are stubbed
// (consent, DNC, suppression, template approval, hours policy, frequency). The real
// `resolveDispatchPolicy` runs, the real `evaluateGate` decides, the real `sendSms` /
// `sendEmail` enforce, and the real escalation path is invoked through spies.
//
// That distinction is the whole point. A harness that stubbed `resolvePolicy` to return a
// verdict would let a test assert "blocked" while proving nothing about whether the check
// ran — the false-green this refactor is most exposed to. Here, a test that says "a DNC'd
// recipient is blocked" fails if the DNC reader stops being consulted.

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Compile the chokepoint graph into a temp dir and load it. Call once per test file. */
export function loadChokepoint(label = 'chokepoint') {
  const out = mkdtempSync(join(tmpdir(), `fsos-${label}-`))
  process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
  execSync(
    `npx tsc src/lib/messaging.ts src/lib/comms/dispatch-policy.ts src/lib/comms/escalation.ts ` +
      `src/lib/comms/gate.ts src/lib/comms/quiet-hours-window.ts src/lib/comms/recipient-timezone.ts ` +
      `--rootDir src --outDir ${out} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop`,
    { stdio: 'ignore' },
  )
  return {
    out,
    messaging: require(join(out, 'lib/messaging.js')),
    policy: require(join(out, 'lib/comms/dispatch-policy.js')),
    gate: require(join(out, 'lib/comms/gate.js')),
    quietHours: require(join(out, 'lib/comms/quiet-hours-window.js')),
  }
}

/**
 * Build the stubbed DB readers. Every field defaults to the PERMISSIVE value so a test only
 * has to state the one condition it is proving; the gate itself is never relaxed.
 */
export function makePolicyDeps(over = {}) {
  const seen = {
    memberConsent: 0, contactConsent: 0, onDNC: 0, suppression: 0,
    templateApproved: 0, aiPolicy: 0, businessHours: 0, sendPolicy: 0,
    hoursWindow: [], recipientLocation: 0, conversationSecurity: 0,
  }
  const deps = {
    async resolveContactLink() {
      return { memberId: over.memberId ?? null, householdId: over.householdId ?? null, agencyId: over.agencyId ?? null }
    },
    async memberConsent() { seen.memberConsent++; return over.memberConsent ?? true },
    async contactConsent() { seen.contactConsent++; return over.contactConsent ?? true },
    async consentRevoked() { return over.consentRevoked ?? false },
    async onDNC() { seen.onDNC++; return over.onDNC ?? false },
    async templateApproved() { seen.templateApproved++; return over.templateApproved ?? true },
    async aiPolicyApproved() { seen.aiPolicy++; return over.aiPolicyApproved ?? true },
    async suppression() {
      seen.suppression++
      return over.suppression ?? { suppressed: false, resolved: true }
    },
    async withinBusinessHours() { seen.businessHours++; return over.withinBusinessHours ?? true },
    async recipientLocation(_memberId, _householdId, to, channel) {
      seen.recipientLocation++
      // Mirror the real reader's floor: on SMS the destination IS a phone. An explicit
      // override still wins, so a test can model a contact with no usable location.
      return over.recipientLocation ?? { phone: channel === 'sms' ? to : null, zip: null }
    },
    async hoursWindow(scopeKey) {
      seen.hoursWindow.push(scopeKey)
      return (over.hoursWindows ?? {})[scopeKey] ?? null
    },
    async sendPolicy() {
      seen.sendPolicy++
      return over.sendPolicy ?? { consentForPurpose: null, frequency: { allowed: true }, collision: { allowed: true } }
    },
    smsLive() { return over.smsLive ?? true },
    async conversationIsSecurity() { seen.conversationSecurity++; return over.conversationSecurity ?? false },
  }
  return { deps, seen }
}

/**
 * A MessagingDeps whose `resolvePolicy` runs the REAL resolver against stubbed readers, and
 * whose escalation/audit/provider calls are recorded rather than performed.
 */
export function makeMessagingDeps(mod, policyOver = {}, opts = {}) {
  const { deps: policyDeps, seen } = makePolicyDeps(policyOver)
  const calls = { escalate: [], auditSent: [], email: [], sms: [] }
  const messagingDeps = {
    resolvePolicy: (ctx) => mod.policy.resolveDispatchPolicy(ctx, policyDeps, opts.now ?? new Date()),
    escalate: async (ctx, outcome, extra) => { calls.escalate.push({ ctx, outcome, extra }) },
    auditSent: async (ctx, result) => { calls.auditSent.push({ ctx, result }) },
    deliverEmail: async (args) => { calls.email.push(args); return { ok: true, id: 'prov_email_1' } },
    deliverSms: async (args) => { calls.sms.push(args); return { ok: true, id: 'prov_sms_1' } },
  }
  return { messagingDeps, calls, seen, policyDeps }
}

/** Provider credentials the chokepoint requires once a message is cleared to send. */
export function withProviderEnv() {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_FROM_EMAIL = 'ops@verified.example'
  process.env.TWILIO_ACCOUNT_SID = 'ACtest'
  process.env.TWILIO_AUTH_TOKEN = 'token'
  process.env.TWILIO_PHONE_NUMBER = '+15550000'
  process.env.SMS_A2P_APPROVED = 'true'
}
