// GUARANTEE (pinned in tests/expected-failures.json): suppression is enforced at DISPATCH
// TIME, independent of anything decided earlier — a DNC entry for the recipient's phone
// blocks the SMS a fully-consented, fully-templated, in-window send would otherwise make,
// while the EMAIL for the same registration still goes out. WS-001-masked today.
//
// PINNED RED until Batch 1: the engine dies on the WS-001 created_at select, so it never
// reaches the gate and neither row is written. The runner FAILS this file if it ever
// passes while pinned.
// Run: node tests/workshop-guarantee-suppression.test.mjs   (rls suite; needs root Postgres)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  guardInfraOrExit, bootCluster, stopCluster, freezeClock, installFetchStub,
  installProviderEnv, resetProviderCalls, providerCalls, freshWorkshopDb, logRows,
  ws001Signature, buildWorkshopBundle,
} from './helpers/workshop-guarantee-common.mjs'

const PGBIN = guardInfraOrExit()
let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

console.log('GUARANTEE: dispatch-time suppression blocks the SMS a consented send would make (real engine, real Postgres)')
let exitCode = 0
try {
  bootCluster(PGBIN)
  installProviderEnv()
  installFetchStub()
  freezeClock('2026-08-06T19:00:00.000Z') // Chicago 13:00 — inside every time window

  const PHONE = '+12145550188'
  const { name, shim } = freshWorkshopDb({
    startsAtIso: '2026-08-06T19:30:00Z',
    endsAtIso: '2026-08-06T20:30:00Z',
    timezone: 'America/Chicago',
    phone: PHONE,
    registeredIso: '2026-08-04T12:00:00Z',
    kinds: ['reminder_1h'],
    // The registrant consented to SMS and every gate precondition passes — but the phone
    // is on the DNC list. Dispatch must fail closed on the number.
    extraSql: `insert into dnc_entries (contact, channel, scope, reason)
                 values ('${PHONE}', 'sms', 'internal', 'test: STOP received elsewhere');`,
  })

  const require = createRequire(import.meta.url)
  const engine = require(await buildWorkshopBundle())

  resetProviderCalls()
  await engine.runReminderPass()
  const rows = logRows(name)
  const sms = rows.filter((r) => r.channel === 'sms' && r.kind === 'reminder_1h')
  const email = rows.filter((r) => r.channel === 'email' && r.kind === 'reminder_1h')
  const sig = ws001Signature(shim)

  ok('the DNC-listed SMS is terminally BLOCKED at dispatch (never deferred, never sent)',
    sms.length === 1 && sms[0].status === 'blocked',
    `log rows: ${JSON.stringify(rows)}\n${sig}`)
  ok('the block names its gate step (dnc/suppression), auditable',
    sms.length === 1 && /dnc|suppress/i.test(String(sms[0].gate_blocked_step ?? sms[0].reason ?? '')), JSON.stringify(sms))
  ok('ZERO Twilio calls were made for the suppressed number', providerCalls.twilio.length === 0)
  ok('the EMAIL for the same registration still sent (suppression is per-contact, not per-person-nuked)',
    email.length === 1 && email[0].status === 'sent', JSON.stringify(email))
  ok('exactly one Resend call', providerCalls.resend.length === 1)

  console.log(`\n${passed} checks passed.`)
} catch (err) {
  exitCode = 1
  console.error(`\n✗ FAILED after ${passed} checks: ${err.message}`)
} finally {
  stopCluster(PGBIN)
}
process.exit(exitCode)
