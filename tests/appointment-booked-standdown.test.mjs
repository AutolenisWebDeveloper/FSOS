// Every appointment stops prospecting for that household — including an FSA-scheduled review, not
// only a public booking (audit D-02 / I-02 / G-01 / G-02). Proves:
//   • the shared fan-out exits Cross-Sell (all open enrollments), Life Conversion and Win-Back and
//     retires the household's queued workforce outreach;
//   • the shared lookup sees native bookings (contact_id, household_id NULL) and review
//     appointments (scheduled_at, starts_at NULL), and reports 'unknown' on a read error;
//   • Life Conversion's per-touch recheck exits on a booking, and DEFERS (no exit) when unknown;
//   • both appointment-creating paths call the fan-out.
// Run: node tests/appointment-booked-standdown.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const out = mkdtempSync(join(tmpdir(), 'fsos-appt-standdown-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
try {
  execSync(
    `npx tsc src/lib/booking/appointment-booked.ts src/lib/life-campaign/eligibility.ts --rootDir src --outDir ${out} ` +
      `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch { /* unresolved '@/…' aliases are expected */ }
for (const f of ['lib/booking/appointment-booked.js', 'lib/life-campaign/eligibility.js']) {
  if (!existsSync(join(out, f))) { console.error(`FATAL: ${f} was not emitted`); process.exit(1) }
}

// ── stub DB: each from(table) answers from `answers[table]` in call order ──
let answers = {}, calls = []
function db() {
  return {
    from(table) {
      const rec = { table, ops: [] }
      calls.push(rec)
      const b = {
        select: (...a) => { rec.ops.push(['select', ...a]); return b },
        eq: (...a) => { rec.ops.push(['eq', ...a]); return b },
        in: (...a) => { rec.ops.push(['in', ...a]); return b },
        is: (...a) => { rec.ops.push(['is', ...a]); return b },
        or: (...a) => { rec.ops.push(['or', ...a]); return b },
        limit: (...a) => { rec.ops.push(['limit', ...a]); return b },
        update: (...a) => { rec.ops.push(['update', ...a]); return b },
        then: (res, rej) => Promise.resolve((answers[table] ?? []).shift() ?? { data: [], count: 0, error: null }).then(res, rej),
      }
      return b
    },
  }
}
const exits = []
const exitMod = (name, single) => ({
  __esModule: true,
  exitOnAppointment: async (i) => {
    exits.push([name, i.householdId])
    if (single) { const n = exits.filter((e) => e[0] === name).length; return { exited: n <= 2 } } // two open xsell rows
    return { exited: 1 }
  },
})
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === '@/lib/supabase/client') return { __esModule: true, getDb: () => db() }
  if (request === '@/lib/audit/log') return { __esModule: true, writeAudit: async () => ({ ok: true }) }
  if (request === '@/lib/cross-sell-life/inbound') return exitMod('xsell', true)
  if (request === '@/lib/life-campaign/inbound') return exitMod('life', false)
  if (request === '@/lib/pipeline-winback/inbound') return exitMod('winback', false)
  return origLoad.call(this, request, ...rest)
}
const { onAppointmentBooked, upcomingAppointmentState } = require(join(out, 'lib/booking/appointment-booked.js'))
const { evaluateEligibility } = require(join(out, 'lib/life-campaign/eligibility.js'))

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const NOW = '2026-10-02T15:00:00.000Z'

console.log('Shared stand-down fan-out')
answers = {}; calls = []
await onAppointmentBooked({ householdId: 'hh-1', actor: 'fsa:u1' })
await t('exits ALL open Cross-Sell enrollments, plus Life Conversion and Win-Back', async () => {
  assert.equal(exits.filter((e) => e[0] === 'xsell').length, 3, 'repeats until no open enrollment remains')
  assert.ok(exits.some((e) => e[0] === 'life' && e[1] === 'hh-1'))
  assert.ok(exits.some((e) => e[0] === 'winback' && e[1] === 'hh-1'))
})
await t('retires the household’s queued workforce outreach as appointment_booked', async () => {
  const q = calls.find((c) => c.table === 'outreach_queue')
  assert.ok(q, 'outreach_queue updated')
  assert.deepEqual(q.ops.find((o) => o[0] === 'update')[1].block_reason, 'appointment_booked')
  assert.ok(q.ops.some((o) => o[0] === 'eq' && o[1] === 'status' && o[2] === 'queued'))
})
await t('a null household is a no-op (never throws)', async () => { await onAppointmentBooked({ householdId: null, actor: 'x' }) })

console.log('\nShared upcoming-appointment lookup')
await t('a native booking linked only by contact_id counts', async () => {
  answers = { appointments: [{ count: 0, error: null }, { count: 1, error: null }], contacts: [{ data: [{ id: 'c1' }], error: null }] }
  calls = []
  assert.equal(await upcomingAppointmentState('hh-1', NOW), 'yes')
  const ors = calls.filter((c) => c.table === 'appointments').map((c) => c.ops.find((o) => o[0] === 'or')?.[1])
  for (const o of ors) assert.match(o, /starts_at\.gt\..*scheduled_at\.gt\./, 'review appointments (scheduled_at only) count too')
})
await t('no appointment anywhere → no', async () => {
  answers = { appointments: [{ count: 0, error: null }], contacts: [{ data: [], error: null }] }
  assert.equal(await upcomingAppointmentState('hh-1', NOW), 'no')
})
await t('a read error → unknown (never a confident no)', async () => {
  answers = { appointments: [{ count: null, error: { message: 'timeout' } }] }
  assert.equal(await upcomingAppointmentState('hh-1', NOW), 'unknown')
})

console.log('\nLife Conversion per-touch recheck')
const base = { isSecurity: false, openOpportunities: [], priorEnrollmentActive: false, optedOut: false, lastTerminalAt: null, cooldownDays: 90, now: NOW, conversionDeadline: '2027-06-01' }
await t('an upcoming appointment makes the enrollment ineligible (appointment_booked)', async () => {
  const r = evaluateEligibility({ ...base, upcomingAppointment: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('appointment_booked'))
})
await t('no appointment → unchanged eligibility', async () => { assert.equal(evaluateEligibility({ ...base, upcomingAppointment: false }).eligible, true) })
await t('the tick defers (does not exit) when the lookup is unknown', async () => {
  assert.match(readFileSync('src/lib/life-campaign/tick.ts', 'utf8'), /if \(eligInput\.upcomingAppointment === null\) continue/)
})

console.log('\nEvery appointment-creating path calls the fan-out')
await t('FSA review scheduling (api/reviews) calls onAppointmentBooked', async () => {
  assert.match(readFileSync('src/app/api/reviews/route.ts', 'utf8'), /onAppointmentBooked\(\{ householdId: v\.data\.household_id/)
})
await t('the public scheduler (book.ts) calls onAppointmentBooked', async () => {
  assert.match(readFileSync('src/lib/booking/book.ts', 'utf8'), /onAppointmentBooked\(\{ householdId:/)
})
console.log(`\nAll ${passed} assertions passed.`)
