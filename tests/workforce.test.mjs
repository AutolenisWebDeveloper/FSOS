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
const {
  priorityOf,
  isSelectable,
  selectForQuota,
  OUTREACH_PROMPTS,
  OUTREACH_AGENTS,
  OUTREACH_MESSAGE_CLASS,
  outreachPurpose,
} = require(join(out, 'outreach.js'))

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

t('win_back: a fresher lapse ranks higher, clamped to 20..80 (life win-back)', () => {
  assert.ok(priorityOf({ source: 'win_back', signal: { lapsedMonths: 0 } }) > priorityOf({ source: 'win_back', signal: { lapsedMonths: 12 } }))
  assert.equal(priorityOf({ source: 'win_back', signal: { lapsedMonths: 0 } }), 80)
  assert.equal(priorityOf({ source: 'win_back', signal: { lapsedMonths: 999 } }), 20)
  assert.equal(priorityOf({ source: 'win_back', signal: {} }), 32) // default 24mo lapse
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

t('life_winback is a first-class outreach agent (win-back promoted off marketing_automation)', () => {
  assert.ok(OUTREACH_AGENTS.includes('life_winback'), 'life_winback must be a registered outreach agent')
  assert.ok(!OUTREACH_AGENTS.includes('marketing_automation'), 'marketing_automation is no longer an outreach agent (campaign-dispatch actor only)')
  assert.match(OUTREACH_PROMPTS.life_winback, /re-?engage|reconnect/i)
})

console.log('§9 purpose + §11 class classification (unblocks auto-send — no missing_purpose_classification)')

t('every outreach source classifies to exactly one non-empty §9 purpose', () => {
  // A missing/undefined purpose is the exact bug that hard-blocked all workforce SMS with
  // `missing_purpose_classification`. Every source the dispatch path can carry must map.
  for (const source of ['cross_sell', 'term_conversion', 'referral_followup', 'win_back']) {
    const p = outreachPurpose(source)
    assert.ok(p && typeof p === 'string', `source ${source} must classify to a purpose`)
  }
})

t('growth outreach is MARKETING; a term-conversion window is POLICY_DEADLINE', () => {
  assert.equal(outreachPurpose('cross_sell'), 'MARKETING')
  assert.equal(outreachPurpose('referral_followup'), 'MARKETING')
  assert.equal(outreachPurpose('win_back'), 'MARKETING')
  assert.equal(outreachPurpose('term_conversion'), 'POLICY_DEADLINE')
})

t('workforce openers are classified approved_first_touch (an auto-send green-zone class)', () => {
  // Must be one of the auto-send classes in ai-authority.ts — otherwise the §11 authority
  // is draft_only and the autonomous agents can never actually send.
  assert.equal(OUTREACH_MESSAGE_CLASS, 'approved_first_touch')
})

console.log(`\nAI Workforce: ${passed} assertions passed.`)
