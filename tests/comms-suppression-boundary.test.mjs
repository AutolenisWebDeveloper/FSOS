// BUSINESS suppression is resolved AT DISPATCH TIME, at the provider boundary.
//
// WHAT THIS USED TO PROVE, AND WHY IT CHANGED. The old design evaluated the gate on context
// the CALLER had computed, then — because arbitrary time could pass between those two
// points on a queued or retried send — re-resolved suppression once more immediately before
// the irreversible provider call. This file proved that second re-check.
//
// That gap no longer exists. Enforcement moved into the chokepoint (lib/messaging.ts), which
// resolves suppression FRESH and then calls the provider with nothing in between, so the
// first resolution IS the boundary resolution. The compensating double-read is gone; the
// invariant it protected is not, and is what this file now proves:
//
//   1. Suppression is read at dispatch time, from the store — never taken from the caller.
//   2. A suppressed recipient never reaches the provider.
//   3. An UNDETERMINED suppression state withholds the send exactly like a positive one
//      (fail closed — unknown must never become allowed).
//   4. Suppression is a NON-escalating business exclusion, still audited, never silent.
//   5. A transactional send declares itself non-suppressible and is never book-suppressed.
//
// Uses the real resolver + real gate with only the DB readers and provider stubbed.
// Run: node tests/comms-suppression-boundary.test.mjs
import assert from 'node:assert/strict'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'

withProviderEnv()
const mod = loadChokepoint('suppr-boundary')

// Fixed instant — 18:00 UTC is 12:00 in America/Chicago, inside the quiet-hours floor.
const NOON = new Date(Date.UTC(2026, 0, 15, 18, 0))
const BODY = 'Your annual review window is open — reply to schedule.'

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

/** A marketing SMS — the suppressible shape. */
function send(state, policy = {}) {
  const { messagingDeps, calls, seen } = makeMessagingDeps(mod, state, { now: NOON })
  return mod.messaging
    .sendSms('+12145550147', BODY, 'mid-1', {
      policy: {
        actor: 'agent:pipeline',
        entity: { type: 'household', id: 'hh1' },
        purpose: 'MARKETING',
        templateKind: 'stored',
        templateId: 't1',
        agencyId: 'a1',
        ...policy,
      },
    }, messagingDeps)
    .then((r) => ({ r, calls, seen }))
}

console.log('Business suppression at the dispatch chokepoint')

await t('the suppression store IS consulted on a marketing send (the check actually runs)', async () => {
  const { r, seen } = await send({})
  assert.equal(r.ok, true, 'an unsuppressed recipient sends')
  assert.equal(seen.suppression, 1, 'resolveEffectiveSuppression was called exactly once, at dispatch')
})

await t('a suppressed recipient is WITHHELD and the provider is never reached', async () => {
  const { r, calls } = await send({ suppression: { suppressed: true, resolved: true, layer: 'agent_book', reason: 'agent blocked' } })
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'suppression')
  assert.equal(calls.sms.length, 0, 'provider MUST NOT be called')
})

await t('suppression is a NON-escalating business exclusion — but still audited, never silent', async () => {
  const { r, calls } = await send({ suppression: { suppressed: true, resolved: true, layer: 'individual', reason: 'client blocked' } })
  assert.equal(r.escalated, false, 'an operator exclusion does not flood the FSA queue')
  assert.equal(calls.escalate.length, 1, 'the withheld send still goes through the audit path')
  assert.equal(calls.escalate[0].outcome.escalate, false)
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'no bare {ok:false} — a reason is returned')
})

await t('FAIL CLOSED: an UNDETERMINED suppression state withholds exactly like a positive one', async () => {
  const { r, calls } = await send({ suppression: { suppressed: false, resolved: false, reason: 'lookup failed' } })
  assert.equal(r.ok, false, 'unknown must never become allowed')
  assert.equal(r.blockedStep, 'suppression')
  assert.equal(calls.sms.length, 0, 'provider MUST NOT be called on an unresolved state')
})

await t('a caller CANNOT assert its way past suppression (the store is the authority)', async () => {
  // The caller claims everything is fine; the store says the agent's book is blocked.
  const { r } = await send(
    { suppression: { suppressed: true, resolved: true, layer: 'agent_book', reason: 'agent blocked' } },
    { suppressible: undefined },
  )
  assert.equal(r.ok, false, 'the dispatch-time read wins over any caller-supplied belief')
  assert.equal(r.blockedStep, 'suppression')
})

await t('a TRANSACTIONAL send declares itself non-suppressible and is never book-suppressed', async () => {
  const { r, seen, calls } = await send(
    { suppression: { suppressed: true, resolved: true, layer: 'agent_book', reason: 'agent blocked' } },
    { purpose: 'APPOINTMENT', suppressible: false, templateKind: 'system_transactional', templateId: null },
  )
  assert.equal(seen.suppression, 0, 'the suppression store is not even consulted for a declared transactional send')
  assert.equal(r.ok, true, 'an appointment reminder is not excluded by a business/book suppression')
  assert.equal(calls.sms.length, 1)
})

await t('an unclassified AUTOMATED send still fails closed into suppressibility', async () => {
  // No purpose, not human-authored, not a test → must be treated as suppressible so
  // unclassified marketing can never slip past the exclusion.
  const { r, seen } = await send(
    { suppression: { suppressed: true, resolved: true, layer: 'individual', reason: 'client blocked' } },
    { purpose: undefined, suppressible: undefined },
  )
  assert.equal(seen.suppression, 1, 'an unclassified send IS suppression-eligible')
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'suppression')
})

console.log(`\n✓ suppression at the boundary: ${passed} proofs passed`)
