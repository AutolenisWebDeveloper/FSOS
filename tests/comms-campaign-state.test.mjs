// The campaign state line (src/lib/comms/campaign-state.ts).
//
// This module exists because the facts determining whether a campaign is doing its job
// were scattered across four sections of the page — approval state in assets, simulation
// state in controls, dead-lettered sends in analytics, enrollment counts in the KPI row.
// A campaign could read "Active" in the header while every template sat in draft, and
// nothing connected those two facts.
//
// The wording is the product here, so it is asserted rather than eyeballed: no raw enums,
// no dangling counts, and severity ordered so a blocker always outranks a note.
//
// Run: node tests/comms-campaign-state.test.mjs

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-campaign-state-'))
// `--rootDir src/lib` pins the emit layout — see the note in
// tests/comms-campaign-presentation.test.mjs for why this is load-bearing.
execSync(
  `npx tsc src/lib/comms/campaign-state.ts src/lib/comms/campaign-presentation.ts src/lib/comms/message-status.ts ` +
    `--rootDir src/lib --outDir ${out} --module commonjs --target es2020 --moduleResolution node ` +
    `--skipLibCheck --esModuleInterop --lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const S = require(join(out, 'comms/campaign-state.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

/** A healthy live campaign — every override is the interesting bit of its own test. */
const HEALTHY = {
  status: 'active',
  simulatedAt: '2026-08-01T12:00:00Z',
  unapprovedTemplates: 0,
  totalTemplates: 20,
  activeEnrollments: 12,
  pausedEnrollments: 0,
  suppressedTouches: 0,
  deadLetterTouches: 0,
  overdueAdvisorTasks: 0,
}
const state = (over = {}) => S.campaignState({ ...HEALTHY, ...over })

console.log('campaign-state — lifecycle tone')

t('every campaign status maps to a tone', () => {
  const expected = {
    active: 'live',
    running: 'live',
    paused: 'held',
    disabled: 'stopped',
    emergency_stopped: 'stopped',
    archived: 'stopped',
    draft: 'preparing',
    approval_pending: 'preparing',
  }
  for (const [status, tone] of Object.entries(expected)) {
    assert.equal(S.campaignStateTone(status), tone, `${status} should be ${tone}`)
  }
})

t('both spellings of live resolve to live', () => {
  // life/win-back use `active`; cross-sell uses `running`.
  assert.equal(state({ status: 'active' }).tone, 'live')
  assert.equal(state({ status: 'running' }).tone, 'live')
})

console.log('\ncampaign-state — the headline')

t('a healthy live campaign says so, with its population', () => {
  const s = state()
  assert.equal(s.tone, 'live')
  assert.match(s.headline, /live/)
  assert.match(s.headline, /12 enrollments are in flight/)
  assert.equal(s.blockers.length, 0)
})

t('REGRESSION: live with nobody enrolled does not read as healthy', () => {
  // "Active" over a row of zeroes was the exact ambiguity this line removes — the
  // campaign is on, and doing nothing, and the old screen said only "Active".
  const s = state({ activeEnrollments: 0 })
  assert.match(s.headline, /no one is enrolled/)
  assert.match(s.headline, /nothing to send/)
})

t('the held subset is named in the headline, not hidden inside the total', () => {
  const s = state({ activeEnrollments: 10, pausedEnrollments: 3 })
  assert.match(s.headline, /10 enrollments are in flight, 3 of them held/)
})

t('singular and plural are both grammatical', () => {
  assert.match(state({ activeEnrollments: 1 }).headline, /1 enrollment is in flight/)
  assert.match(state({ activeEnrollments: 2 }).headline, /2 enrollments are in flight/)
  assert.ok(!state({ activeEnrollments: 1 }).headline.includes('1 enrollments'))
})

t('each stopped status gets its own sentence, not one generic one', () => {
  const archived = state({ status: 'archived' }).headline
  const stopped = state({ status: 'emergency_stopped' }).headline
  const disabled = state({ status: 'disabled' }).headline
  assert.match(archived, /archived and read-only/)
  assert.match(stopped, /emergency-stopped/)
  assert.match(disabled, /disabled/)
  assert.notEqual(archived, stopped)
  assert.notEqual(stopped, disabled)
})

t('paused explains that enrollments keep their place', () => {
  const s = state({ status: 'paused', activeEnrollments: 5 })
  assert.equal(s.tone, 'held')
  assert.match(s.headline, /hold their place/)
})

t('draft and approval-pending are distinguished', () => {
  assert.match(state({ status: 'draft' }).headline, /draft/)
  assert.match(state({ status: 'approval_pending' }).headline, /waiting on approval/)
})

t('no headline leaks a raw enum underscore', () => {
  for (const status of ['active', 'running', 'paused', 'disabled', 'emergency_stopped', 'archived', 'draft', 'approval_pending']) {
    const h = state({ status }).headline
    assert.ok(!h.includes('_'), `"${h}" leaks an enum`)
  }
})

console.log('\ncampaign-state — blockers')

t('REGRESSION: a live campaign whose templates are unapproved is not reported as fine', () => {
  // The defect this whole module is for: status Active, every touch undispatchable.
  const s = state({ unapprovedTemplates: 20, totalTemplates: 20 })
  assert.equal(s.tone, 'live')
  const blocker = s.blockers.find((b) => b.key === 'unapproved-templates')
  assert.ok(blocker, 'unapproved templates must surface as a blocker')
  assert.match(blocker.text, /20 of 20 templates/)
  assert.match(blocker.text, /cannot\s+dispatch/)
  assert.equal(blocker.href, '/app/comms/templates', 'a blocker must say where to go')
})

t('a single unapproved template reads grammatically', () => {
  const b = state({ unapprovedTemplates: 1, totalTemplates: 20 }).blockers.find((x) => x.key === 'unapproved-templates')
  assert.match(b.text, /1 of 20 templates/)
  assert.match(b.text, /that touch cannot dispatch/)
})

t('dead-lettered touches are a blocker — they never self-heal', () => {
  const b = state({ deadLetterTouches: 3 }).blockers.find((x) => x.key === 'dead-letter')
  assert.ok(b)
  assert.match(b.text, /3 touches/)
  assert.match(b.text, /reached no one/)
})

t('a never-simulated campaign is flagged before it goes live, not after', () => {
  assert.ok(state({ status: 'draft', simulatedAt: null }).blockers.some((b) => b.key === 'never-simulated'))
  // Once live, the warning is noise — the decision has been made.
  assert.ok(!state({ status: 'active', simulatedAt: null }).blockers.some((b) => b.key === 'never-simulated'))
})

t('an archived campaign is not nagged about simulation', () => {
  // Archived is read-only by design; an un-run simulation there is not a defect.
  const s = state({ status: 'archived', simulatedAt: null })
  assert.ok(!s.blockers.some((b) => b.key === 'never-simulated'))
})

t('a fully healthy campaign has no blockers and no notes', () => {
  const s = state()
  assert.deepEqual(s.blockers, [])
  assert.deepEqual(s.notes, [])
})

console.log('\ncampaign-state — notes stay notes')

t('suppressed touches are a note, never a blocker — that is the gate working', () => {
  const s = state({ suppressedTouches: 7 })
  assert.equal(s.blockers.length, 0, 'suppression is correct behaviour, not a defect')
  const n = s.notes.find((x) => x.key === 'suppressed')
  assert.ok(n)
  assert.match(n.text, /7 touches/)
  // A blocked send must never be silently dropped — the reason has to be visible.
  assert.match(n.text, /consent, quiet hours, DNC, or the securities firewall/)
})

t('overdue advisor tasks are a note, and say the timeline is unaffected', () => {
  const s = state({ overdueAdvisorTasks: 2 })
  assert.equal(s.blockers.length, 0)
  const n = s.notes.find((x) => x.key === 'overdue-advisor')
  assert.match(n.text, /2 advisor tasks are overdue/)
  assert.match(n.text, /never stalls/)
})

t('blockers are ordered most-severe first', () => {
  const s = state({
    status: 'draft',
    simulatedAt: null,
    unapprovedTemplates: 5,
    totalTemplates: 20,
    deadLetterTouches: 2,
  })
  assert.deepEqual(
    s.blockers.map((b) => b.key),
    ['unapproved-templates', 'dead-letter', 'never-simulated'],
  )
})

console.log('\ncampaign-state — copy discipline')

t('every string is a complete sentence', () => {
  const s = state({
    status: 'draft',
    simulatedAt: null,
    unapprovedTemplates: 4,
    totalTemplates: 20,
    deadLetterTouches: 1,
    suppressedTouches: 2,
    overdueAdvisorTasks: 3,
  })
  for (const text of [s.headline, ...s.blockers.map((b) => b.text), ...s.notes.map((n) => n.text)]) {
    assert.match(text, /[.!]$/, `"${text}" does not end as a sentence`)
    assert.match(text, /^[A-Z0-9]/, `"${text}" does not start capitalized`)
    assert.ok(!text.includes('  '), `"${text}" has a double space`)
    assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b/.test(text), `"${text}" leaked a placeholder value`)
  }
})

t('the count is never rendered without its total', () => {
  // `4 of undefined templates` was the obvious failure mode when totalTemplates is absent.
  const b = S.campaignState({ ...HEALTHY, unapprovedTemplates: 4, totalTemplates: undefined }).blockers.find(
    (x) => x.key === 'unapproved-templates',
  )
  assert.ok(!b.text.includes('undefined'))
  assert.match(b.text, /4 of 4 templates/)
})

t('zero counts produce no items at all, rather than "0 things are wrong"', () => {
  const s = state({ unapprovedTemplates: 0, deadLetterTouches: 0, suppressedTouches: 0, overdueAdvisorTasks: 0 })
  assert.equal(s.blockers.length, 0)
  assert.equal(s.notes.length, 0)
})

rmSync(out, { recursive: true, force: true })
console.log(`\n${passed} checks passed.`)
