// GUARANTEE (pinned in tests/expected-failures.json): quiet-hours deferral is computed in
// the RECIPIENT-local timezone — WS-005 (currently masked by WS-001). Fixture: the VENUE is
// America/Chicago but the registrant's phone is +1 907 (Alaska → America/Anchorage). At the
// frozen instant 15:00Z it is 10:00 at the venue (inside the 9–20 floor) but 07:00 for the
// RECIPIENT (outside): the SMS must be DEFERRED, not sent. Advancing the clock to 19:00Z
// (11:00 Anchorage) and re-running must then send it — proving defer-then-retry.
//
// PINNED RED until Batch 1: today the engine (a) dies on the WS-001 created_at select and
// (b) evaluates quiet hours in the VENUE timezone (comms-engine.ts) — either defect alone
// keeps this red. The runner FAILS this file if it ever passes while pinned.
// Run: node tests/workshop-guarantee-quiet-hours.test.mjs   (rls suite; needs root Postgres)
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

console.log('GUARANTEE: recipient-local quiet hours defer, then retry sends (real engine, real Postgres)')
let exitCode = 0
try {
  bootCluster(PGBIN)
  installProviderEnv()
  installFetchStub()
  // 2026-08-06T15:00Z: venue (Chicago) 10:00 — in window; recipient (Anchorage, from the
  // +1907 NPA) 07:00 — OUTSIDE. Session starts 15:30Z → the 1h reminder is due now.
  freezeClock('2026-08-06T15:00:00.000Z')

  const { name, shim } = freshWorkshopDb({
    startsAtIso: '2026-08-06T15:30:00Z',
    endsAtIso: '2026-08-06T16:30:00Z',
    timezone: 'America/Chicago',
    phone: '+19075550123',
    registeredIso: '2026-08-04T12:00:00Z',
    kinds: ['reminder_1h'],
  })

  const require = createRequire(import.meta.url)
  const engine = require(await buildWorkshopBundle())

  resetProviderCalls()
  await engine.runReminderPass()
  const rows1 = logRows(name)
  const smsRows1 = rows1.filter((r) => r.channel === 'sms')
  const sig = ws001Signature(shim)

  ok('recipient-local 07:00 → the SMS is DEFERRED (not sent, not blocked)',
    smsRows1.length === 1 && smsRows1[0].status === 'deferred',
    `log rows: ${JSON.stringify(rows1)}\n${sig}`)
  ok('deferred SMS made ZERO Twilio calls', providerCalls.twilio.length === 0)
  ok('the deferral is recipient-based, not venue-based (venue hour was 10:00 — in window)',
    smsRows1.length === 1 && smsRows1[0].status === 'deferred')

  // Advance to 19:00Z (Anchorage 11:00 — in window); the deferred slot must retry and send.
  freezeClock('2026-08-06T19:00:00.000Z')
  await engine.runReminderPass()
  const rows2 = logRows(name)
  const smsRows2 = rows2.filter((r) => r.channel === 'sms')

  ok('after the window opens recipient-local, the SAME slot flips deferred → sent (no new row)',
    smsRows2.length === 1 && smsRows2[0].status === 'sent', JSON.stringify(rows2))
  ok('exactly one Twilio call total (defer never double-sends)', providerCalls.twilio.length === 1)

  console.log(`\n${passed} checks passed.`)
} catch (err) {
  exitCode = 1
  console.error(`\n✗ FAILED after ${passed} checks: ${err.message}`)
} finally {
  stopCluster(PGBIN)
}
process.exit(exitCode)
