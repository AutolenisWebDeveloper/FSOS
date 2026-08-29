// GUARANTEE (pinned in tests/expected-failures.json): send-once key uniqueness under
// repeated cron runs — WS-001/WS-016. The REAL engine (runReminderPass → sendWorkshopMessage
// → sendThroughGate → dispatcher) executed 3× against a real Postgres must produce EXACTLY
// ONE terminal send-log row per (registration, channel, kind) and exactly one provider call
// per channel — runs 2 and 3 add nothing.
//
// PINNED RED until Batch 1: the engine selects the nonexistent `created_at` column from
// workshop_registrations (WS-001), so every pass silently handles zero registrations and
// this file fails on "exactly one sent row". The failure output prints the WS-001 signature
// from the engine's actual SQL. The runner FAILS this file if it ever passes while pinned.
// Run: node tests/workshop-guarantee-send-once.test.mjs   (rls suite; needs root Postgres)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  guardInfraOrExit, bootCluster, stopCluster, freezeClock, installFetchStub,
  installProviderEnv, resetProviderCalls, providerCalls, freshWorkshopDb, logRows,
  ws001Signature, buildWorkshopBundle, IDS,
} from './helpers/workshop-guarantee-common.mjs'

const PGBIN = guardInfraOrExit()
let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

console.log('GUARANTEE: send-once under repeated cron runs (real engine, real Postgres)')
let exitCode = 0
try {
  bootCluster(PGBIN)
  installProviderEnv()
  installFetchStub()
  // Thursday 2026-08-06 19:00Z = 13:00 America/Chicago. Session starts 19:30Z → the 1h
  // reminder window [18:30Z, 19:30Z] contains now; registration long precedes fire-time.
  freezeClock('2026-08-06T19:00:00.000Z')

  const { name, shim } = freshWorkshopDb({
    startsAtIso: '2026-08-06T19:30:00Z',
    endsAtIso: '2026-08-06T20:30:00Z',
    timezone: 'America/Chicago',
    phone: '+12145550188',
    registeredIso: '2026-08-04T12:00:00Z',
    kinds: ['reminder_1h'],
  })

  const require = createRequire(import.meta.url)
  const engine = require(await buildWorkshopBundle())

  resetProviderCalls()
  const r1 = await engine.runReminderPass()
  const rowsAfter1 = logRows(name)
  const sent1 = rowsAfter1.filter((r) => r.status === 'sent')
  const sig = ws001Signature(shim)

  ok('run 1 produces at least one SENT log row (engine is alive)', sent1.length >= 1,
    `pass result: ${JSON.stringify(r1)}\nlog rows: ${JSON.stringify(rowsAfter1)}\n${sig}`)
  ok('run 1: exactly one row per (channel, kind) — the unique claim held', (() => {
    const keys = rowsAfter1.map((r) => `${r.channel}:${r.kind}`)
    return new Set(keys).size === keys.length
  })(), JSON.stringify(rowsAfter1))
  const providersAfter1 = providerCalls.resend.length + providerCalls.twilio.length
  ok('run 1 dispatched through the real providers (stubbed at fetch)', providersAfter1 >= 1)

  await engine.runReminderPass()
  await engine.runReminderPass()
  const rowsAfter3 = logRows(name)
  const sent3 = rowsAfter3.filter((r) => r.status === 'sent')

  ok('runs 2+3 add ZERO new send-log rows (send-once key absorbed the re-runs)',
    rowsAfter3.length === rowsAfter1.length, `after1=${JSON.stringify(rowsAfter1)}\nafter3=${JSON.stringify(rowsAfter3)}`)
  ok('runs 2+3 make ZERO additional provider calls',
    providerCalls.resend.length + providerCalls.twilio.length === providersAfter1)
  ok('sent rows carry the dispatched message handle (comm_message_id)',
    sent3.every((r) => !!r.comm_message_id), JSON.stringify(sent3))
  ok('every sent row is for the fixture registration', sent3.every((r) => r.registration_id === IDS.reg))

  console.log(`\n${passed} checks passed.`)
} catch (err) {
  exitCode = 1
  console.error(`\n✗ FAILED after ${passed} checks: ${err.message}`)
} finally {
  stopCluster(PGBIN)
}
process.exit(exitCode)
