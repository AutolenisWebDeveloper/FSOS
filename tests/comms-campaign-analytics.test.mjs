// The shared campaign analytics contract (src/lib/comms/campaign-analytics.ts).
//
// Three engines previously returned three incompatible shapes behind one function name, so no
// dashboard component could be shared. This pins the superset AND the pure tallies underneath
// it, including the reconciliation bug the unification fixed:
//
//   Life Conversion and Win-Back headlined `enrollments['active']` — the narrow bucket — while
//   computing byPhase over the broad set (active + both paused states). The KPI tile read
//   "Active enrollments 12" directly above a phase distribution summing to 15, on the same
//   screen, with nothing to say which was right.
//
// Run: node tests/comms-campaign-analytics.test.mjs

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-campaign-analytics-'))
execSync(
  `npx tsc src/lib/comms/campaign-analytics.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const A = require(join(out, 'campaign-analytics.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// Mirrors the state sets each engine declares in its own analytics.ts.
const COMMON = {
  activeStates: ['active', 'paused_for_conversation', 'paused_by_admin'],
  pausedStates: ['paused_for_conversation', 'paused_by_admin'],
  completedStates: ['completed'],
  exitedStates: ['exited'],
  suppressedStates: ['suppressed'],
}
const PHASES = { midFromTouch: 7, accelFromTouch: 13 }

console.log('campaign-analytics — rate')

t('a zero denominator is 0%, never NaN or Infinity', () => {
  assert.equal(A.rate(0, 0), 0)
  assert.equal(A.rate(5, 0), 0)
  assert.ok(Number.isFinite(A.rate(5, 0)))
})

t('rates carry one decimal', () => {
  assert.equal(A.rate(1, 3), 33.3)
  assert.equal(A.rate(1, 2), 50)
  assert.equal(A.rate(2, 2), 100)
})

console.log('\ncampaign-analytics — phase bucketing')

t('boundaries are inclusive lower bounds', () => {
  assert.equal(A.bucketPhase(6, PHASES), 'early')
  assert.equal(A.bucketPhase(7, PHASES), 'mid')
  assert.equal(A.bucketPhase(12, PHASES), 'mid')
  assert.equal(A.bucketPhase(13, PHASES), 'accelerated')
})

t('a null cursor is early, not a crash', () => {
  assert.equal(A.bucketPhase(null, PHASES), 'early')
  assert.equal(A.bucketPhase(undefined, PHASES), 'early')
  assert.equal(A.bucketPhase(0, PHASES), 'early')
})

console.log('\ncampaign-analytics — enrollment tally')

t('REGRESSION: totals.active and byPhase count the same population', () => {
  // The reconciliation bug. Before unification the headline used only `active` while the
  // phase distribution used the broad set, so the two disagreed on the same screen.
  const rows = [
    { status: 'active', current_touch_no: 3 },
    { status: 'active', current_touch_no: 9 },
    { status: 'paused_for_conversation', current_touch_no: 15 },
    { status: 'paused_by_admin', current_touch_no: 2 },
    { status: 'completed', current_touch_no: 20 },
    { status: 'suppressed', current_touch_no: 4 },
  ]
  const { totals, byPhase } = A.tallyEnrollments(rows, { ...COMMON, phases: PHASES })
  const phaseSum = byPhase.early + byPhase.mid + byPhase.accelerated
  assert.equal(totals.active, 4, 'all four in-flight rows count as active')
  assert.equal(phaseSum, totals.active, `phase distribution (${phaseSum}) must reconcile with active (${totals.active})`)
  assert.deepEqual(byPhase, { early: 2, mid: 1, accelerated: 1 })
})

t('the held subset stays visible rather than being silently folded in', () => {
  const rows = [
    { status: 'active', current_touch_no: 1 },
    { status: 'paused_for_conversation', current_touch_no: 2 },
    { status: 'paused_by_admin', current_touch_no: 3 },
  ]
  const { totals } = A.tallyEnrollments(rows, COMMON)
  assert.equal(totals.active, 3)
  assert.equal(totals.paused, 2, 'an operator must be able to see how much of "active" is actually held')
})

t('a suppressed enrollment counts once in exited and once in suppressed', () => {
  // Never double-counted inside exited itself — suppression is a REASON for exiting.
  const rows = [{ status: 'suppressed' }, { status: 'suppressed' }, { status: 'exited' }]
  const { totals } = A.tallyEnrollments(rows, COMMON)
  assert.equal(totals.suppressed, 2)
  assert.equal(totals.exited, 3, 'two suppressed + one exited = three that left')
})

t('the raw per-status map is preserved for any breakdown a surface wants', () => {
  const rows = [{ status: 'active' }, { status: 'active' }, { status: 'completed' }]
  const { enrollments } = A.tallyEnrollments(rows, COMMON)
  assert.deepEqual(enrollments, { active: 2, completed: 1 })
})

t('optional blocks are absent, not empty, when the engine does not measure them', () => {
  // A shared component tests for presence. An always-present zeroed block would render a
  // row of zeroes on an engine that has no such concept.
  const { byPhase, byCategory } = A.tallyEnrollments([{ status: 'active' }], COMMON)
  assert.equal(byPhase, undefined)
  assert.equal(byCategory, undefined)
})

t('win-back categories are tallied only when asked for', () => {
  const rows = [
    { status: 'active', winback_category: 'lost' },
    { status: 'active', winback_category: 'lost' },
    { status: 'active', winback_category: 'stalled_quote' },
    { status: 'active', winback_category: null },
  ]
  const { byCategory } = A.tallyEnrollments(rows, { ...COMMON, categorize: true })
  assert.deepEqual(byCategory, { lost: 2, stalled_quote: 1 }, 'a null category is not a bucket')
})

t('an empty roster produces zeroes, not undefined', () => {
  const { totals, enrollments } = A.tallyEnrollments([], COMMON)
  assert.deepEqual(totals, { active: 0, paused: 0, completed: 0, exited: 0, suppressed: 0 })
  assert.deepEqual(enrollments, {})
})

console.log('\ncampaign-analytics — execution tally')

t('only a sent execution counts toward a channel', () => {
  // A suppressed or deferred touch never reached anyone. Counting it as a send would
  // overstate reach on a compliance-facing dashboard.
  const rows = [
    { status: 'sent', kind: 'email' },
    { status: 'sent', kind: 'sms' },
    { status: 'sent', kind: 'ai_conversation' },
    { status: 'suppressed', kind: 'email' },
    { status: 'scheduled', kind: 'sms' },
  ]
  const { touches, channels } = A.tallyExecutions(rows)
  assert.deepEqual(channels, { email: 1, sms: 1, ai: 1 })
  assert.equal(touches.sent, 3)
  assert.equal(touches.suppressed, 1)
  assert.equal(touches.scheduled, 1)
})

t('suppressed and dead-lettered touches stay counted, never dropped', () => {
  // Compliance rule: a blocked send is logged and escalated, never silently dropped —
  // so the UI must be able to show it.
  const { touches } = A.tallyExecutions([
    { status: 'suppressed' },
    { status: 'dead_letter' },
    { status: 'missed' },
    { status: 'skipped' },
  ])
  assert.equal(touches.suppressed, 1)
  assert.equal(touches.dead_letter, 1)
  assert.equal(touches.missed, 1)
  assert.equal(touches.skipped, 1)
})

t('an unrecognized execution status is ignored rather than corrupting a count', () => {
  const { touches } = A.tallyExecutions([{ status: 'some_future_status' }, { status: 'sent' }])
  assert.equal(touches.sent, 1)
  assert.equal(Object.values(touches).reduce((a, b) => a + b, 0), 1)
})

console.log('\ncampaign-analytics — advisor tally')

t('escalate and reassign count as overdue, not as separate silent states', () => {
  const advisor = A.tallyAdvisor([
    { status: 'fulfilled' },
    { status: 'overdue' },
    { status: 'escalate' },
    { status: 'reassign' },
    { status: 'missed' },
    { status: 'pending' },
  ])
  assert.equal(advisor.total, 6)
  assert.equal(advisor.fulfilled, 1)
  assert.equal(advisor.overdue, 3, 'overdue + escalate + reassign are all "late and escalating"')
  assert.equal(advisor.missed, 1)
})

console.log('\ncampaign-analytics — funnel (Cross-Sell Life)')

t('the funnel counts terminal states, and every enrollment enters it', () => {
  const rows = [
    { status: 'running' },
    { status: 'appointment_scheduled' },
    { status: 'appointment_scheduled' },
    { status: 'quote_requested' },
    { status: 'application_started' },
    { status: 'policy_issued' },
    { status: 'purchased_elsewhere' },
  ]
  const funnel = A.tallyFunnel(rows)
  assert.equal(funnel.enrolled, 7)
  assert.equal(funnel.appointments, 2)
  assert.equal(funnel.quotes, 1)
  assert.equal(funnel.applications, 1)
  assert.equal(funnel.issued, 1)
  assert.equal(funnel.purchasedElsewhere, 1)
})

t('opt-outs come from the exit reason, across all three opt-out paths', () => {
  const funnel = A.tallyFunnel([
    { status: 'cancelled', exit_reason: 'sms_stop' },
    { status: 'cancelled', exit_reason: 'email_unsubscribe' },
    { status: 'cancelled', exit_reason: 'global_suppression' },
    { status: 'cancelled', exit_reason: 'not_interested' },
  ])
  assert.equal(funnel.optOuts, 3)
  assert.equal(funnel.notInterested, 1, 'not-interested is a soft exit, not an opt-out')
})

t('each rate is against the previous stage, not against enrolled', () => {
  const rates = A.funnelRates({
    enrolled: 100,
    appointments: 20,
    quotes: 10,
    applications: 5,
    issued: 1,
    purchasedElsewhere: 0,
    notInterested: 0,
    optOuts: 0,
  })
  assert.equal(rates.enrollToAppointment, 20)
  assert.equal(rates.appointmentToQuote, 50, '10 of 20 appointments, not 10 of 100 enrolled')
  assert.equal(rates.quoteToApplication, 50)
  assert.equal(rates.applicationToIssued, 20)
  assert.equal(rates.overall, 1, 'overall is issued over enrolled')
})

t('an empty funnel produces zero rates, not NaN', () => {
  const rates = A.funnelRates(A.tallyFunnel([]))
  for (const [name, value] of Object.entries(rates)) {
    assert.ok(Number.isFinite(value), `${name} is not finite`)
    assert.equal(value, 0)
  }
})

console.log('\ncampaign-analytics — the contract holds across all three engines')

t('every engine returns the universal core', () => {
  // Read each engine's analytics.ts and confirm it populates the shared core. A shared
  // dashboard component reads these four fields on every engine; an engine that stops
  // returning one of them breaks that component at runtime, not at the call site.
  const ENGINES = [
    'src/lib/life-campaign/analytics.ts',
    'src/lib/cross-sell-life/analytics.ts',
    'src/lib/pipeline-winback/analytics.ts',
  ]
  for (const file of ENGINES) {
    const src = readFileSync(file, 'utf8')
    assert.ok(
      src.includes("from '@/lib/comms/campaign-analytics'"),
      `${file} does not import the shared contract — it has forked again`,
    )
    // Parse the returned object literal so a field can only satisfy this by actually
    // being returned — not by appearing somewhere else in the file.
    const returned = src.slice(src.lastIndexOf('return {'))
    for (const field of ['status', 'enrollments', 'totals', 'touches', 'advisor']) {
      assert.ok(
        new RegExp(`(^|[\\s{,])${field}\\s*[,:}]`).test(returned),
        `${file} does not return \`${field}\` — the shared core is incomplete`,
      )
    }
    assert.ok(!/export interface (Campaign|Winback)Analytics/.test(src), `${file} redeclares the analytics interface`)
  }
})

t('the engine-specific blocks stay with the engine that measures them', () => {
  const xsell = readFileSync('src/lib/cross-sell-life/analytics.ts', 'utf8')
  const winback = readFileSync('src/lib/pipeline-winback/analytics.ts', 'utf8')
  const life = readFileSync('src/lib/life-campaign/analytics.ts', 'utf8')

  assert.ok(xsell.includes('funnel') && xsell.includes('rates'), 'cross-sell owns the funnel')
  assert.ok(winback.includes('eligibleNow') && winback.includes('byCategory'), 'win-back owns eligibility + category')
  assert.ok(!life.includes('funnel'), 'life does not measure a funnel and must not fabricate one')
  assert.ok(!life.includes('eligibleNow'), 'life has no eligibility view')
})

rmSync(out, { recursive: true, force: true })
console.log(`\n${passed} checks passed.`)
