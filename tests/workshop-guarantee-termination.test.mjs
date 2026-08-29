// GUARANTEE (pinned in tests/expected-failures.json): termination is a durable ABSORBING
// state — once a workshop SMS is terminally blocked (STOP/DNC-backed), no later cron run
// retries, re-sends, or auto-resumes it, no matter how many times the cron fires. The
// deferred state stays retryable (proven in workshop-guarantee-quiet-hours); the blocked
// state must never be. WS-026/WS-001-masked today.
//
// PINNED RED until Batch 1: the engine dies on the WS-001 created_at select, so no row is
// ever written and the absorbing property cannot hold. The runner FAILS this file if it
// ever passes while pinned.
// Run: node tests/workshop-guarantee-termination.test.mjs   (rls suite; needs root Postgres)
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

console.log('GUARANTEE: terminal block is absorbing across repeated cron runs (real engine, real Postgres)')
let exitCode = 0
try {
  bootCluster(PGBIN)
  installProviderEnv()
  installFetchStub()
  freezeClock('2026-08-06T19:00:00.000Z')

  const PHONE = '+12145550188'
  const { name, shim } = freshWorkshopDb({
    startsAtIso: '2026-08-06T19:30:00Z',
    endsAtIso: '2026-08-06T20:30:00Z',
    timezone: 'America/Chicago',
    phone: PHONE,
    registeredIso: '2026-08-04T12:00:00Z',
    kinds: ['reminder_1h'],
    extraSql: `insert into dnc_entries (contact, channel, scope, reason)
                 values ('${PHONE}', 'sms', 'internal', 'test: STOP');`,
  })

  const require = createRequire(import.meta.url)
  const engine = require(await buildWorkshopBundle())

  resetProviderCalls()
  await engine.runReminderPass()
  const rows1 = logRows(name)
  const sms1 = rows1.filter((r) => r.channel === 'sms')
  const sig = ws001Signature(shim)

  ok('run 1: the STOP/DNC-backed SMS lands terminally blocked',
    sms1.length === 1 && sms1[0].status === 'blocked',
    `log rows: ${JSON.stringify(rows1)}\n${sig}`)
  const attempts1 = sms1[0]?.attempts

  // The cron fires three more times — the blocked slot must be ABSORBING: same single row,
  // same status, no attempt-count growth, zero provider calls.
  await engine.runReminderPass()
  await engine.runReminderPass()
  await engine.runReminderPass()
  const rows4 = logRows(name)
  const sms4 = rows4.filter((r) => r.channel === 'sms')

  ok('runs 2-4: still exactly one SMS row (nothing re-enqueued)', sms4.length === 1, JSON.stringify(rows4))
  ok('runs 2-4: the block never flips or resumes (status stays blocked)', sms4[0].status === 'blocked')
  ok('runs 2-4: the attempt counter never grows (no hidden retry)', sms4[0].attempts === attempts1,
    `attempts: run1=${attempts1} run4=${sms4[0].attempts}`)
  ok('runs 1-4: ZERO Twilio calls in total for the terminated number', providerCalls.twilio.length === 0)

  console.log(`\n${passed} checks passed.`)
} catch (err) {
  exitCode = 1
  console.error(`\n✗ FAILED after ${passed} checks: ${err.message}`)
} finally {
  stopCluster(PGBIN)
}
process.exit(exitCode)
