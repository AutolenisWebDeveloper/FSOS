// Comms UI status vocabulary (src/lib/comms/message-status.ts).
//
// Guards the defects this module was written to remove:
//   • `failed`/`bounced` rendering as the amber `pending` chip, so a hard bounce read
//     to the FSA as "still in flight" on /comms/sms and /comms/email while
//     /comms/delivery showed the same row as `lost`.
//   • The gate's two tiers being flattened: a non-escalating operational DEFERRAL
//     (retries itself) shown identically to a COMPLIANCE BLOCK (needs a human).
//   • Raw enum leakage (`blocked: quiet_hours`) into advisor-facing cells.
//
// Also pins every GateStep to a label, so adding a step to gate.ts without
// classifying it here fails a test rather than silently rendering an enum.
//
// Run: node tests/comms-message-status.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-msgstatus-'))
execSync(
  `npx tsc src/lib/comms/message-status.ts src/lib/comms/gate.ts src/lib/compliance/guardrail.ts ` +
    `src/lib/comms/timeline.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop ` +
    `--lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { deliveryStatus, gateOutcome, needsAttention } = require(join(out, 'comms/message-status.js'))
const { statusBadge, normalizeStatus } = require(join(out, 'comms/timeline.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('message-status — delivery status')

t('only a confirmed delivery is the success chip', () => {
  assert.equal(deliveryStatus('delivered').variant, 'won')
  // `sent` is provider-ACCEPTED, not provider-CONFIRMED. It stays in-flight amber,
  // matching timeline.ts — claiming success on acceptance overstates what we know.
  assert.equal(deliveryStatus('sent').variant, 'pending')
})

t('REGRESSION: failed and bounced are never the pending chip', () => {
  for (const s of ['failed', 'bounced']) {
    const p = deliveryStatus(s)
    assert.notEqual(p.variant, 'pending', `${s} must not read as in-flight`)
    assert.equal(p.variant, 'lost')
  }
})

t('queued is the only in-flight state', () => {
  assert.equal(deliveryStatus('queued').variant, 'pending')
})

t('blocked gets the blocked chip, not a failure chip', () => {
  assert.equal(deliveryStatus('blocked').variant, 'blocked')
})

t('unknown provider status degrades to neutral, never to success', () => {
  const p = deliveryStatus('deferred_by_some_new_provider')
  assert.equal(p.variant, 'outline')
  assert.equal(p.label, 'deferred_by_some_new_provider')
})

t('null status renders an em dash, not "null"', () => {
  assert.equal(deliveryStatus(null).label, '—')
  assert.equal(deliveryStatus(undefined).label, '—')
})

console.log('message-status — gate outcome tiers')

// The four non-escalating steps in gate.ts: held and retried, no compliance event.
const DEFERRALS = ['sms_live', 'business_hours', 'frequency', 'collision']
// Everything else escalates to a human.
const BLOCKS = [
  'ownership',
  'consent',
  'quiet_hours',
  'delegation',
  'dnc',
  'approved_template',
  'personalization',
  'recommendation',
  'is_security',
  'data_confidence',
  'other_rule',
]

t('operational deferrals are tier "deferred" and read amber', () => {
  for (const step of DEFERRALS) {
    const o = gateOutcome({ blockedStep: step })
    assert.equal(o.tier, 'deferred', `${step} is a deferral, not a compliance block`)
    assert.equal(o.variant, 'pending')
  }
})

t('compliance blocks are tier "blocked" and read as blocked', () => {
  for (const step of BLOCKS) {
    const o = gateOutcome({ blockedStep: step })
    assert.equal(o.tier, 'blocked', `${step} must escalate to a human`)
    assert.equal(o.variant, 'blocked')
  }
})

t('quiet_hours (TCPA floor) is a BLOCK, business_hours (operator) is a DEFERRAL', () => {
  // The distinction gate.ts draws deliberately — the legal floor is not a soft hold.
  assert.equal(gateOutcome({ blockedStep: 'quiet_hours' }).tier, 'blocked')
  assert.equal(gateOutcome({ blockedStep: 'business_hours' }).tier, 'deferred')
})

t('REGRESSION: no raw enum reaches the label', () => {
  for (const step of [...DEFERRALS, ...BLOCKS]) {
    const { label } = gateOutcome({ blockedStep: step })
    assert.ok(!label.includes('_'), `"${label}" leaks the ${step} enum`)
    assert.notEqual(label, step)
    assert.ok(label[0] === label[0].toUpperCase(), `"${label}" should be sentence case`)
  }
})

t('every GateStep in gate.ts is classified here', () => {
  // Parse the union straight out of the source so a new step cannot be added
  // without a matching label — the failure mode is a raw enum in the UI.
  const src = readFileSync('src/lib/comms/gate.ts', 'utf8')
  const union = src.slice(src.indexOf('export type GateStep ='), src.indexOf('export interface GateInput'))
  const steps = [...union.matchAll(/\|\s*'([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(steps.length >= 15, `expected the full GateStep union, parsed ${steps.length}`)
  for (const step of steps) {
    const o = gateOutcome({ blockedStep: step })
    assert.notEqual(o.label, step, `GateStep "${step}" has no advisor-facing label`)
  }
  // And the test's own tier lists stay exhaustive.
  const covered = new Set([...DEFERRALS, ...BLOCKS])
  for (const step of steps) assert.ok(covered.has(step), `GateStep "${step}" is unclassified in this test`)
})

t('unrecognized block step fails safe: blocked, not sent', () => {
  const o = gateOutcome({ blockedStep: 'some_future_step' })
  assert.equal(o.tier, 'blocked')
  assert.equal(o.variant, 'blocked')
})

console.log('message-status — clean sends')

t('consent at send is surfaced as a positive result', () => {
  const o = gateOutcome({ blockedStep: null, consentAtSend: true })
  assert.equal(o.tier, 'sent')
  assert.equal(o.variant, 'won')
})

t('a clean send without recorded consent is neutral, not a success chip', () => {
  const o = gateOutcome({ blockedStep: null, consentAtSend: false })
  assert.equal(o.tier, 'sent')
  assert.equal(o.variant, 'draft')
})

t('a block wins over consent — the row is defined by WHY it was held', () => {
  const o = gateOutcome({ blockedStep: 'dnc', consentAtSend: true })
  assert.equal(o.tier, 'blocked')
})

console.log('message-status — attention routing')

t('failed, bounced, and compliance blocks need a human', () => {
  assert.equal(needsAttention({ delivery_status: 'failed' }), true)
  assert.equal(needsAttention({ delivery_status: 'bounced' }), true)
  assert.equal(needsAttention({ delivery_status: 'blocked', blocked_step: 'dnc' }), true)
})

t('deferrals and healthy sends do not', () => {
  assert.equal(needsAttention({ delivery_status: 'blocked', blocked_step: 'frequency' }), false)
  assert.equal(needsAttention({ delivery_status: 'blocked', blocked_step: 'business_hours' }), false)
  assert.equal(needsAttention({ delivery_status: 'delivered' }), false)
  assert.equal(needsAttention({ delivery_status: 'queued' }), false)
})

t('a spam complaint is an attention row — the worst deliverability outcome cannot read as routine', () => {
  assert.equal(needsAttention({ delivery_status: 'complained' }), true)
})

console.log('message-status — schema coverage')

// The DB CHECK is the authority on which values can reach the UI. Parsing it here means
// a migration that widens the constraint fails this test instead of shipping a new status
// that silently renders as the neutral "unrecognized" chip.
const CHECK_RE = /delivery_status in \(([^)]*)\)/g
const migrations = readFileSync('supabase/migrations/033_comms_inbound_knowledge_campaigns.sql', 'utf8')
const allowed = [...migrations.matchAll(CHECK_RE)]
  .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((v) => v[1]))

t('every delivery_status the DB permits has an explicit presentation', () => {
  assert.ok(allowed.length >= 8, `expected the widened CHECK, parsed: ${allowed.join(',')}`)
  for (const status of allowed) {
    const p = deliveryStatus(status)
    assert.notEqual(
      p.description,
      'Unrecognized delivery status — shown as reported by the provider.',
      `${status} is a valid DB value but falls through to the unrecognized chip`,
    )
  }
})

console.log('message-status — parity with the timeline vocabulary')

// message-status.ts (message log) and timeline.ts (contact/appointment timeline) both
// present comm_messages.delivery_status. They may word things differently, but the SAME
// row must never be a success chip in one surface and a failure chip in the other.
const SEVERITY = { won: 'good', pending: 'neutral', draft: 'neutral', outline: 'neutral', lost: 'bad', blocked: 'bad' }

t('no delivery status is a success in one surface and a failure in the other', () => {
  for (const status of allowed) {
    const mine = SEVERITY[deliveryStatus(status).variant]
    const theirs = SEVERITY[statusBadge(normalizeStatus(status)).key]
    assert.equal(mine, theirs, `${status}: message log reads "${mine}", timeline reads "${theirs}"`)
  }
})

console.log(`\n${passed} assertions passed`)
