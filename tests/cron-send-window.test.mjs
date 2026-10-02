// Daily crons that put client messages on the wire must FIRE inside the 09:00–20:00 floor in
// every continental US zone, in both standard and daylight time — otherwise the gate holds or
// burns the whole day's batch. Owner decision 8 (docs/ops/automation-inventory.md §10) moved
// campaign-dispatch (was 12:00 UTC = 06:00–08:00 local) and district-nurture-tick (was 14:00 UTC
// = 06:00–09:00 Pacific) to 17:00 UTC. The other daily senders are listed as REPORTED: their
// windows are an open owner decision, pinned here so a change to them is deliberate.
// Run: node tests/cron-send-window.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons
const sched = (job) => crons.find((c) => c.path === `/api/cron/${job}`)?.schedule
// Continental offsets: Eastern, Central, Mountain, Arizona (no DST), Pacific — standard and DST.
const OFFSETS = [-5, -4, -6, -5, -7, -6, -7, -8, -7]
const insideEverywhere = (utcHour) => OFFSETS.every((o) => { const h = (utcHour + o + 24) % 24; return h >= 9 && h < 20 })

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }
console.log('Client-sending daily crons fire inside the floor everywhere (decision 8)')
for (const job of ['campaign-dispatch', 'district-nurture-tick']) {
  t(`${job} runs daily at 17:00 UTC`, () => assert.equal(sched(job), '0 17 * * *'))
  t(`${job}: 17:00 UTC is 09:00–13:00 local in every continental zone`, () => assert.ok(insideEverywhere(17)))
}
console.log('\nReported, not changed (owner decision pending) — pinned so a change is deliberate')
for (const [job, s] of [
  ['life-conversion-tick', '0 15 * * *'], ['pipeline-winback-tick', '0 15 * * *'],
  ['workforce-orchestrator', '0 15 * * *'], ['cross-sell-life-tick', '0 16 * * *'],
]) {
  t(`${job} stays ${s} (outside the floor in Pacific standard time)`, () => {
    assert.equal(sched(job), s)
    assert.equal(insideEverywhere(Number(s.split(' ')[1])), false)
  })
}
console.log(`\nAll ${passed} assertions passed.`)
