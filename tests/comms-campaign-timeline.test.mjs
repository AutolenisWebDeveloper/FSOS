// Pure geometry for the campaign timeline ribbon (src/lib/comms/campaign-timeline.ts).
//
// The ribbon is the signature element on the three campaign screens; it renders entirely
// from this module's output. The layout math (day → percent, phase-band spans, enrollment
// share/intensity, axis labels) is pinned here so it is proven by assertion rather than by
// eyeballing a rendered page — which the audit noted could not be done in this environment.
//
// Run: node tests/comms-campaign-timeline.test.mjs

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-campaign-timeline-'))
// `--rootDir src/lib` pins the emit layout — see the note in comms-campaign-analytics.test.mjs.
execSync(
  `npx tsc src/lib/comms/campaign-timeline.ts --rootDir src/lib --outDir ${out} --module commonjs ` +
    `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const T = require(join(out, 'comms/campaign-timeline.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// Representative fixtures, shaped like each engine's real schedule.ts + byPhase.
const LIFE_PHASES = [
  { key: 'early', label: 'Early', fromDay: 0, activeCount: 3 },
  { key: 'mid', label: 'Mid', fromDay: 48, activeCount: 9 },
  { key: 'accelerated', label: 'Accelerated', fromDay: 135, activeCount: 0 },
]
const TOUCHES = [
  { touch_no: 1, day_offset: 0, kind: 'email' },
  { touch_no: 2, day_offset: 90, kind: 'sms' },
  { touch_no: 3, day_offset: 180, kind: 'advisor_outreach' },
]

console.log('campaign-timeline — dayToPct / clampPct')

t('a day is placed as a percentage of the run length', () => {
  assert.equal(T.dayToPct(0, 180), 0)
  assert.equal(T.dayToPct(90, 180), 50)
  assert.equal(T.dayToPct(180, 180), 100)
})

t('a zero-length track never divides by zero', () => {
  assert.equal(T.dayToPct(5, 0), 0)
  assert.ok(Number.isFinite(T.dayToPct(5, 0)))
})

t('positions are clamped into 0–100 and NaN collapses to 0', () => {
  assert.equal(T.dayToPct(200, 180), 100) // a touch past the end pins to the right edge
  assert.equal(T.dayToPct(-10, 180), 0)
  assert.equal(T.clampPct(Number.NaN), 0)
  assert.equal(T.clampPct(Infinity), 100)
})

console.log('\ncampaign-timeline — marks')

t('marks are sorted by day and carry their position', () => {
  const l = T.layoutTimeline([{ touch_no: 5, day_offset: 100, kind: 'email' }, { touch_no: 1, day_offset: 10, kind: 'sms' }], { days: 200 })
  assert.deepEqual(l.marks.map((m) => m.touch_no), [1, 5])
  assert.equal(l.marks[0].leftPct, 5)
  assert.equal(l.marks[1].leftPct, 50)
  assert.equal(l.totalTouches, 2)
})

t('channels are counted in a stable order, unknown kinds kept not dropped', () => {
  const l = T.layoutTimeline(
    [
      { touch_no: 1, day_offset: 0, kind: 'advisor_outreach' },
      { touch_no: 2, day_offset: 1, kind: 'email' },
      { touch_no: 3, day_offset: 2, kind: 'email' },
      { touch_no: 4, day_offset: 3, kind: 'carrier_pigeon' },
    ],
    { days: 10 },
  )
  // Known channels first in canonical order, then the unknown kind — never silently dropped.
  assert.deepEqual(l.channelCounts, [
    { key: 'email', count: 2 },
    { key: 'advisor_outreach', count: 1 },
    { key: 'carrier_pigeon', count: 1 },
  ])
})

console.log('\ncampaign-timeline — phase bands')

t('bands span from each phase start to the next (last runs to the end)', () => {
  const l = T.layoutTimeline(TOUCHES, { days: 180, phases: LIFE_PHASES })
  assert.equal(l.bands.length, 3)
  assert.deepEqual(l.bands.map((b) => [b.fromDay, b.toDay]), [[0, 48], [48, 135], [135, 180]])
  // widthPct of the mid band = (135-48)/180*100
  assert.ok(Math.abs(l.bands[1].widthPct - ((135 - 48) / 180) * 100) < 1e-9)
})

t('phases out of order are sorted before banding', () => {
  const l = T.layoutTimeline([], { days: 100, phases: [
    { key: 'b', label: 'B', fromDay: 50, activeCount: 1 },
    { key: 'a', label: 'A', fromDay: 0, activeCount: 1 },
  ] })
  assert.deepEqual(l.bands.map((b) => b.key), ['a', 'b'])
})

t('share and intensity describe where the active book sits', () => {
  const l = T.layoutTimeline(TOUCHES, { days: 180, phases: LIFE_PHASES })
  assert.equal(l.totalActive, 12)
  const mid = l.bands.find((b) => b.key === 'mid')
  const early = l.bands.find((b) => b.key === 'early')
  const accel = l.bands.find((b) => b.key === 'accelerated')
  assert.equal(mid.share, 9 / 12)
  assert.equal(early.share, 3 / 12)
  // intensity is relative to the busiest band, so the busiest fills fully and empties are 0.
  assert.equal(mid.intensity, 1)
  assert.equal(accel.intensity, 0)
  assert.equal(accel.share, 0)
})

t('an empty book yields zero share and zero intensity, never NaN', () => {
  const l = T.layoutTimeline(TOUCHES, { days: 180, phases: LIFE_PHASES.map((p) => ({ ...p, activeCount: 0 })) })
  assert.equal(l.totalActive, 0)
  for (const b of l.bands) {
    assert.equal(b.share, 0)
    assert.equal(b.intensity, 0)
    assert.ok(Number.isFinite(b.share) && Number.isFinite(b.intensity))
  }
})

t('REGRESSION: a phase configured past the end never yields an inverted band', () => {
  // The last band used to take `toDay = days` unconditionally, so a phase whose fromDay sat
  // beyond the campaign length produced toDay < fromDay. widthPct still clamped to 0, so it
  // rendered invisibly — but any consumer reading the raw fromDay/toDay pair got incoherent
  // geometry. Every band must satisfy 0 <= fromDay <= toDay <= days.
  const l = T.layoutTimeline([], { days: 100, phases: [
    { key: 'a', label: 'A', fromDay: 0, activeCount: 1 },
    { key: 'b', label: 'B', fromDay: 250, activeCount: 2 },
  ] })
  for (const b of l.bands) {
    assert.ok(b.fromDay <= b.toDay, `${b.key}: inverted band (${b.fromDay} → ${b.toDay})`)
    assert.ok(b.fromDay >= 0 && b.toDay <= 100, `${b.key}: band escapes the run (${b.fromDay} → ${b.toDay})`)
    assert.ok(b.widthPct >= 0 && b.leftPct >= 0)
  }
})

t('a phase starting before day 0 is clamped into the run', () => {
  const l = T.layoutTimeline([], { days: 100, phases: [
    { key: 'a', label: 'A', fromDay: -30, activeCount: 1 },
    { key: 'b', label: 'B', fromDay: 50, activeCount: 1 },
  ] })
  assert.equal(l.bands[0].fromDay, 0)
  assert.deepEqual(l.bands.map((b) => [b.fromDay, b.toDay]), [[0, 50], [50, 100]])
})

t('a negative count is floored to zero, not counted against the book', () => {
  const l = T.layoutTimeline([], { days: 100, phases: [
    { key: 'a', label: 'A', fromDay: 0, activeCount: -5 },
    { key: 'b', label: 'B', fromDay: 50, activeCount: 4 },
  ] })
  assert.equal(l.totalActive, 4)
  assert.equal(l.bands[0].activeCount, 0)
})

console.log('\ncampaign-timeline — no-phase engines (Cross-Sell Life)')

t('with no phases there are no bands but the schedule still lays out', () => {
  const l = T.layoutTimeline(TOUCHES, { days: 180 })
  assert.equal(l.bands.length, 0)
  assert.equal(l.totalActive, 0)
  assert.equal(l.marks.length, 3)
  // axis still labels the two ends
  assert.deepEqual(l.axisDays, [0, 180])
})

console.log('\ncampaign-timeline — axis + acceleration')

t('axis labels the ends and every band boundary, deduped and ordered', () => {
  const l = T.layoutTimeline(TOUCHES, { days: 180, phases: LIFE_PHASES })
  assert.deepEqual(l.axisDays, [0, 48, 135, 180])
})

t('acceleration marker resolves to a position when supplied', () => {
  const l = T.layoutTimeline(TOUCHES, { days: 180, phases: LIFE_PHASES, acceleratesFromDay: 135 })
  assert.equal(l.acceleratesFromDay, 135)
  assert.equal(l.accelLeftPct, 75)
  const none = T.layoutTimeline(TOUCHES, { days: 180 })
  assert.equal(none.acceleratesFromDay, null)
  assert.equal(none.accelLeftPct, null)
})

rmSync(out, { recursive: true, force: true })
console.log(`\n${passed} checks passed.`)
