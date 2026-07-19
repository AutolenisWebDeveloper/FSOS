// AI Workforce gate — proves the PURE outreach core (lib/ai/outreach.ts): the daily
// quota is never exceeded, prioritization ranks the right work first, and the
// securities firewall + consent/DNC/contactability constraints make a non-eligible
// candidate UNSELECTABLE (never contacted). Compiles the pure module in isolation
// (no Supabase) — same harness as guardrail.test.mjs. Run: node tests/workforce.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-workforce-'))
execSync(
  `npx tsc src/lib/ai/outreach.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { priorityOf, isSelectable, selectForQuota, OUTREACH_PROMPTS, OUTREACH_AGENTS } = require(
  join(out, 'outreach.js'),
)

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// A fully-eligible candidate factory (override per test).
function cand(over = {}) {
  return {
    source: 'cross_sell', agentKey: 'cross_sell', entityType: 'household', entityId: 'id-' + Math.random().toString(36).slice(2),
    householdId: 'hh', memberId: 'm1', channel: 'sms',
    contactable: true, hasConsent: true, onDNC: false, isSecurity: false,
    signal: { gapScore: 60 }, reason: 'gap', recipientName: 'Sam',
    ...over,
  }
}

console.log('Prioritization (priorityOf)')

t('term-conversion inside 30 days is maximally urgent', () => {
  assert.equal(priorityOf({ source: 'term_conversion', signal: { daysRemaining: 20 } }), 100)
  assert.ok(priorityOf({ source: 'term_conversion', signal: { daysRemaining: 200 } }) < 100)
})

t('an SLA-breached referral outranks a fresh one', () => {
  const breached = priorityOf({ source: 'referral_followup', signal: { slaBreached: true } })
  const fresh = priorityOf({ source: 'referral_followup', signal: { ageHours: 1 } })
  assert.equal(breached, 100)
  assert.ok(breached > fresh)
})

t('a bigger cross-sell gap ranks higher, clamped to 0..100', () => {
  assert.ok(priorityOf({ source: 'cross_sell', signal: { gapScore: 90 } }) > priorityOf({ source: 'cross_sell', signal: { gapScore: 10 } }))
  assert.equal(priorityOf({ source: 'cross_sell', signal: { gapScore: 9999 } }), 100)
})

console.log('Selectability (firewall + consent + DNC + contactability)')

t('a securities-flagged candidate is NEVER selectable (firewall §2.1)', () => {
  assert.equal(isSelectable(cand({ isSecurity: true })), false)
})
t('no consent → not selectable (TCPA)', () => {
  assert.equal(isSelectable(cand({ hasConsent: false })), false)
})
t('on DNC → not selectable', () => {
  assert.equal(isSelectable(cand({ onDNC: true })), false)
})
t('no contact method → not selectable', () => {
  assert.equal(isSelectable(cand({ contactable: false, memberId: null })), false)
})
t('fully eligible → selectable', () => {
  assert.equal(isSelectable(cand()), true)
})

console.log('Quota selection (selectForQuota)')

t('never selects more than the daily target', () => {
  const list = Array.from({ length: 25 }, () => cand())
  const { selected } = selectForQuota(list, 10)
  assert.equal(selected.length, 10)
})

t('a securities candidate is dropped with a firewall reason (never silently)', () => {
  const list = [cand({ isSecurity: true, signal: { gapScore: 100 } }), cand({ signal: { gapScore: 1 } })]
  const { selected, skipped } = selectForQuota(list, 5)
  assert.ok(!selected.some((c) => c.isSecurity))
  assert.ok(skipped.some((s) => s.reason === 'securities_firewall'))
})

t('over-quota candidates are recorded as skipped, not dropped', () => {
  const list = Array.from({ length: 8 }, () => cand())
  const { selected, skipped } = selectForQuota(list, 3)
  assert.equal(selected.length, 3)
  assert.equal(skipped.filter((s) => s.reason === 'over_daily_quota').length, 5)
})

t('higher-priority candidates are selected first', () => {
  const hi = cand({ signal: { gapScore: 95 }, entityId: 'hi' })
  const lo = cand({ signal: { gapScore: 5 }, entityId: 'lo' })
  const { selected } = selectForQuota([lo, hi], 1)
  assert.equal(selected[0].entityId, 'hi')
})

t('daily_target of 0 selects nothing (agent paused)', () => {
  const { selected } = selectForQuota([cand(), cand()], 0)
  assert.equal(selected.length, 0)
})

console.log('Green-zone prompts')

t('every outreach agent has a prompt that forbids recommendations', () => {
  for (const key of OUTREACH_AGENTS) {
    const p = OUTREACH_PROMPTS[key]
    assert.ok(p, `missing prompt for ${key}`)
    assert.match(p, /NEVER/)
    assert.match(p, /recommend/i)
  }
})

console.log(`\nAI Workforce: ${passed} assertions passed.`)
