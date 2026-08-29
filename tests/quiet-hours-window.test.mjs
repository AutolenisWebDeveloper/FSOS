// Configurable quiet hours — the pure window algebra (quiet-hours-window.ts).
//
// The two properties this file exists to pin:
//
//   1. CONFIG NARROWS, NEVER WIDENS. Enforced structurally by intersection: the effective
//      window is a subset of every input, so no campaign or worker row can grant a send a
//      time the statutory floor forbids. The brief's required intersection cases are here
//      verbatim: floor 9–20 ∩ campaign 7–22 → 9–20; ∩ campaign 10–18 → 10–18.
//
//   2. TWO KINDS OF "OUT OF WINDOW". Outside the statutory floor = escalating compliance
//      block. Inside the floor but outside a configured narrowing = NON-escalating
//      DEFERRAL with a computable next opening. On a purpose with no floor (POLICY_DEADLINE,
//      APPOINTMENT, email) a configured-window miss must NEVER surface as a suppression.
//
// Run: node tests/quiet-hours-window.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-qhw-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch {} })
execSync(
  `npx tsc src/lib/comms/quiet-hours-window.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --strict`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  STATUTORY_FLOOR,
  intersectWindows,
  withinWindow,
  hoursUntilWindowOpens,
  evaluateQuietHours,
  isEmptyWindow,
} = require(join(out, 'quiet-hours-window.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const ALL = [0, 1, 2, 3, 4, 5, 6]
const W = (startHour, endHour, days = ALL) => ({ startHour, endHour, days })

// ── Intersection ─────────────────────────────────────────────────────────────
console.log('Intersection — config narrows, never widens')

t('THE BRIEF CASE: floor 9–20 ∩ campaign 7–22 → 9–20 (a wider config cannot widen)', () => {
  const eff = intersectWindows([STATUTORY_FLOOR, W(7, 22)])
  assert.equal(eff.startHour, 9)
  assert.equal(eff.endHour, 20)
})

t('THE BRIEF CASE: floor 9–20 ∩ campaign 10–18 → 10–18 (a tighter config narrows)', () => {
  const eff = intersectWindows([STATUTORY_FLOOR, W(10, 18)])
  assert.equal(eff.startHour, 10)
  assert.equal(eff.endHour, 18)
})

t('three layers: floor ∩ campaign 10–18 ∩ worker 12–20 → 12–18', () => {
  const eff = intersectWindows([STATUTORY_FLOOR, W(10, 18), W(12, 20)])
  assert.equal(eff.startHour, 12)
  assert.equal(eff.endHour, 18)
})

t('days intersect too: weekdays ∩ Mon–Wed → Mon–Wed', () => {
  const eff = intersectWindows([W(9, 20, [1, 2, 3, 4, 5]), W(9, 20, [1, 2, 3])])
  assert.deepEqual([...eff.days].sort(), [1, 2, 3])
})

t('disjoint hour spans → null (no permissible time, never "unrestricted")', () => {
  assert.equal(intersectWindows([W(9, 12), W(14, 18)]), null)
})

t('disjoint day sets → null', () => {
  assert.equal(intersectWindows([W(9, 20, [1, 2]), W(9, 20, [5, 6])]), null)
})

t('PROPERTY: the intersection is always a subset of every input', () => {
  const cases = [
    [W(9, 20), W(7, 22)],
    [W(9, 20), W(10, 18)],
    [W(8, 21, [1, 2, 3]), W(9, 19, [2, 3, 4]), W(10, 22)],
  ]
  for (const layers of cases) {
    const eff = intersectWindows(layers)
    if (!eff) continue
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        if (withinWindow(h, d, eff)) {
          for (const layer of layers) {
            assert.ok(withinWindow(h, d, layer), `(${h},${d}) inside effective but outside a layer — WIDENED`)
          }
        }
      }
    }
  }
})

// ── Next opening ─────────────────────────────────────────────────────────────
console.log('\nDeferral target — hoursUntilWindowOpens')

t('already open → 0', () => assert.equal(hoursUntilWindowOpens(12, 3, W(9, 20)), 0))
t('21:00 → opens at 9:00 next day = 12h', () => assert.equal(hoursUntilWindowOpens(21, 3, W(9, 20)), 12))
t('6:00 → opens at 9:00 same day = 3h', () => assert.equal(hoursUntilWindowOpens(6, 3, W(9, 20)), 3))
t('Friday 21:00 with a weekday-only window → Monday 9:00 = 60h', () =>
  assert.equal(hoursUntilWindowOpens(21, 5, W(9, 20, [1, 2, 3, 4, 5])), 60))
t('an empty window can never open → null', () => {
  assert.equal(hoursUntilWindowOpens(12, 3, W(9, 9)), null)
  assert.ok(isEmptyWindow(W(9, 9)))
})

// ── The composed decision ────────────────────────────────────────────────────
console.log('\nevaluateQuietHours — floor vs configured window are DIFFERENT outcomes')

t('inside floor, no config → allowed', () => {
  const d = evaluateQuietHours({ localHour: 12, localDay: 3, floorApplies: true })
  assert.equal(d.outcome, 'allowed')
  assert.equal(d.allowed, true)
})

t('OUTSIDE THE FLOOR → escalating compliance block (outside_floor)', () => {
  const d = evaluateQuietHours({ localHour: 22, localDay: 3, floorApplies: true })
  assert.equal(d.outcome, 'outside_floor')
  assert.equal(d.allowed, false)
  assert.equal(d.escalate, true, 'the statutory floor escalates')
  assert.equal(d.blockedBy, 'floor')
})

t('the floor verdict is INDEPENDENT of any configured window (checked first, never masked)', () => {
  const d = evaluateQuietHours({ localHour: 22, localDay: 3, floorApplies: true, campaignWindow: W(7, 23) })
  assert.equal(d.outcome, 'outside_floor', 'a wide campaign window cannot re-admit 22:00')
  assert.equal(d.escalate, true)
})

t('inside floor but outside campaign window → NON-escalating deferral naming the layer', () => {
  const d = evaluateQuietHours({ localHour: 9, localDay: 3, floorApplies: true, campaignWindow: W(10, 18) })
  assert.equal(d.outcome, 'outside_configured_window')
  assert.equal(d.allowed, false)
  assert.equal(d.escalate, false, 'an operator preference never raises a compliance event')
  assert.equal(d.blockedBy, 'campaign')
  assert.equal(d.hoursUntilOpen, 1, 'deferral carries the computable next opening')
})

t('worker window narrows further and is named when it is the culprit', () => {
  const d = evaluateQuietHours({ localHour: 10, localDay: 3, floorApplies: true, campaignWindow: W(9, 20), workerWindow: W(12, 18) })
  assert.equal(d.outcome, 'outside_configured_window')
  assert.equal(d.blockedBy, 'worker')
})

console.log('\nExempt purposes (no floor) — a configured window DEFERS, never suppresses')

t('no floor + no config → allowed at any hour (unchanged default behavior)', () => {
  for (const h of [2, 8, 22, 23]) {
    const d = evaluateQuietHours({ localHour: h, localDay: 3, floorApplies: false })
    assert.equal(d.outcome, 'allowed', `hour ${h} must pass with no floor and no config`)
  }
})

t('THE BRIEF CASE: exempt purpose + configured window + out-of-window → DEFERRED, not suppressed', () => {
  // A POLICY_DEADLINE SMS (floorApplies=false) with a campaign window of 10–18, at 08:00.
  const d = evaluateQuietHours({ localHour: 8, localDay: 3, floorApplies: false, campaignWindow: W(10, 18) })
  assert.equal(d.outcome, 'outside_configured_window', 'a deferral outcome')
  assert.equal(d.escalate, false, 'never a compliance event')
  assert.equal(d.hoursUntilOpen, 2, 'held to the next opening — a delayed message, not a blocked one')
})

t('exempt purpose inside its configured window → allowed', () => {
  const d = evaluateQuietHours({ localHour: 12, localDay: 3, floorApplies: false, campaignWindow: W(10, 18) })
  assert.equal(d.outcome, 'allowed')
})

t('exempt purpose: the configured window is NOT intersected with the floor it is exempt from', () => {
  // A deadline notice may legitimately be windowed to 7–9am by the operator; with no floor
  // in the stack, 8:00 is INSIDE that window even though it is outside 9–20.
  const d = evaluateQuietHours({ localHour: 8, localDay: 3, floorApplies: false, campaignWindow: W(7, 9) })
  assert.equal(d.outcome, 'allowed')
})

t('unsatisfiable config (disjoint from the floor) → held as misconfiguration, non-escalating', () => {
  const d = evaluateQuietHours({ localHour: 12, localDay: 3, floorApplies: true, campaignWindow: W(21, 23) })
  assert.equal(d.outcome, 'window_unsatisfiable')
  assert.equal(d.allowed, false)
  assert.equal(d.escalate, false)
  assert.equal(d.hoursUntilOpen, null, 'there is no next opening to defer to')
})

console.log(`\nAll ${passed} assertions passed.`)
