// Crons that put client messages on the wire must FIRE inside the 09:00–20:00 floor in every
// continental US zone, in both standard and daylight time — otherwise the gate holds the batch and
// every hold escalates.
//   • Owner decision 8 moved campaign-dispatch and district-nurture-tick off 12:00/14:00 UTC.
//   • Finding 5 (owner, 2026-10-04): the FIVE dispatch crons run HOURLY from 17:00 to 23:00 UTC,
//     with at most one touch per enrollment per day (gate.ts oneTouchPerDay at every cursor
//     advance, plus a send-time sent-today check that covers admin resume / replay / restart).
//   • Owner decision (round 4): workforce-orchestrator moves from 0 15 to 0 17 UTC for the same
//     reason (15:00 UTC is 07:00 Pacific standard time). Pinned so a change is deliberate.
// Run: node tests/cron-send-window.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons
const sched = (job) => crons.find((c) => c.path === `/api/cron/${job}`)?.schedule
// Continental offsets: Eastern, Central, Mountain, Arizona (no DST), Pacific — standard and DST.
const OFFSETS = [-5, -4, -6, -5, -7, -6, -7, -8, -7]
const insideEverywhere = (utcHour) => OFFSETS.every((o) => { const h = (utcHour + o + 24) % 24; return h >= 9 && h < 20 })

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const DISPATCH = ['campaign-dispatch', 'district-nurture-tick', 'life-conversion-tick', 'pipeline-winback-tick', 'cross-sell-life-tick']
console.log('The five dispatch crons run hourly inside the all-zone floor (finding 5)')
for (const job of DISPATCH) {
  t(`${job} runs at 0 17-23 * * *`, () => assert.equal(sched(job), '0 17-23 * * *'))
}
t('every hour 17:00–23:00 UTC is inside 09:00–20:00 in every continental zone, standard and daylight', () => {
  for (let h = 17; h <= 23; h++) assert.ok(insideEverywhere(h), `${h}:00 UTC`)
  assert.equal(insideEverywhere(16), false, '16:00 UTC is 08:00 Pacific standard — why the window starts at 17')
  assert.equal(insideEverywhere(0), false, '00:00 UTC is 20:00 Eastern daylight — why it ends at 23')
})

console.log('\nworkforce-orchestrator (owner, round 4)')
t('workforce-orchestrator runs at 0 17 * * * — inside the floor in every continental zone', () => {
  assert.equal(sched('workforce-orchestrator'), '0 17 * * *')
  assert.ok(insideEverywhere(17))
  assert.equal(insideEverywhere(15), false, 'why it moved: 15:00 UTC is 07:00 Pacific standard')
})

console.log('\nAt most one touch per enrollment per day (oneTouchPerDay)')
const out = mkdtempSync(join(tmpdir(), 'fsos-cron-window-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
execSync(`npx tsc src/lib/comms/gate.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`, { stdio: 'inherit' })
const { oneTouchPerDay } = createRequire(import.meta.url)(join(out, 'comms/gate.js'))
const NOW = '2026-10-05T18:00:00.000Z'
t('an overdue next touch is pushed to the start of the next UTC day, never fired an hour later', () => {
  assert.equal(oneTouchPerDay('2026-10-01T13:00:00.000Z', NOW), '2026-10-06T00:00:00.000Z')
  assert.equal(oneTouchPerDay('2026-10-05T13:00:00.000Z', NOW), '2026-10-06T00:00:00.000Z')
  assert.equal(oneTouchPerDay('2026-10-05T22:00:00.000Z', NOW), '2026-10-06T00:00:00.000Z', 'later the same day is still the same day')
})
t('a next touch due tomorrow or later keeps its scheduled time', () => {
  assert.equal(oneTouchPerDay('2026-10-06T13:00:00.000Z', NOW), '2026-10-06T13:00:00.000Z')
  assert.equal(oneTouchPerDay('2026-10-20T13:00:00.000Z', NOW), '2026-10-20T13:00:00.000Z')
})
t('an unreadable due time is pushed to tomorrow, never sooner', () => {
  assert.equal(oneTouchPerDay('not a date', NOW), '2026-10-06T00:00:00.000Z')
})
t('every engine cursor advance and the drip advance go through it', () => {
  for (const f of ['src/lib/life-campaign/tick.ts', 'src/lib/pipeline-winback/tick.ts', 'src/lib/cross-sell-life/tick.ts', 'src/lib/district-nurture/tick.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /next_touch_at: oneTouchPerDay\(/, f)
    assert.doesNotMatch(src, /next_touch_at: `\$\{(next\.dueDate|dueDay)\}T13:00:00\.000Z`/, `${f}: an unguarded cursor advance remains`)
  }
  assert.match(readFileSync('src/jobs/handlers.ts', 'utf8'), /next_send_at: oneTouchPerDay\(/)
})
t('a touch re-armed for today by resume / replay / restart is held at send time (every engine)', () => {
  for (const [f, ex] of [['life-campaign', 'life_campaign_executions'], ['pipeline-winback', 'pipeline_winback_executions'], ['cross-sell-life', 'xsell_life_campaign_executions'], ['district-nurture', 'district_nurture_executions']]) {
    const src = readFileSync(`src/lib/${f}/tick.ts`, 'utf8')
    const guard = src.search(new RegExp(`\\.from\\('${ex}'\\)\\s*\\.select\\('id'\\)\\s*\\.eq\\('enrollment_id', e\\.id\\)\\s*\\.eq\\('status', 'sent'\\)\\s*\\.gte\\('executed_at', `))
    const claim = src.indexOf('// Idempotency: claim')
    assert.ok(guard > 0, `${f}: no send-time sent-today check`)
    assert.ok(guard < claim, `${f}: the check must run before the touch is claimed`)
    assert.match(src, /if \(sentTodayErr\) continue/, `${f}: a failed read must hold the touch`)
  }
})
t('no engine schedules two touches on one day by design (so per-enrollment = per-channel)', () => {
  for (const f of ['life-campaign', 'pipeline-winback', 'cross-sell-life', 'district-nurture']) {
    const s = readFileSync(`src/lib/${f}/schedule.ts`, 'utf8')
    const days = [...s.matchAll(/touch_no:\s*\d+[^}]*?day_offset:\s*(\d+)/g)].map((m) => m[1])
    assert.ok(days.length >= 20, `${f}: parsed ${days.length} touches`)
    assert.equal(new Set(days).size, days.length, `${f}: two touches share a day`)
  }
})
console.log(`\nAll ${passed} assertions passed.`)
