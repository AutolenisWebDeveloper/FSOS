// Pipeline Win-Back Campaign — eligibility gate (pure, no DB/clock). Proves the §4 candidacy +
// the owner-confirmed precedence/suppression (ADR-031): securities firewall first, opt-out/DNC,
// stalled-candidate stage + staleness floor, advisor-ownership precedence, appointment/conversation
// suppression, and the duplicate-enrollment guard.
// Run: node tests/pipeline-winback-eligibility.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-pwb-elig-'))
execSync(
  `npx tsc src/lib/pipeline-winback/eligibility.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateWinbackEligibility, winbackCategory, WINBACK_CANDIDATE_STAGES, classifyRecheckOutcome } = require(join(out, 'eligibility.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// A baseline ELIGIBLE stalled-quote opportunity.
const base = {
  isSecurity: false,
  optedOut: false,
  stage: 'quoted_proposed',
  staleDays: 45,
  staleMinDays: 30,
  hasActiveAdvisorOpportunity: false,
  hasUpcomingAppointment: false,
  inActiveConversation: false,
  priorEnrollmentActive: false,
}

console.log('evaluateWinbackEligibility — the §4 gate')

t('a stalled, opted-in, non-securities candidate is eligible', () => {
  const r = evaluateWinbackEligibility(base)
  assert.equal(r.eligible, true)
  assert.deepEqual(r.reasons, [])
})

t('securities opportunities are firewalled out (§4.1)', () => {
  const r = evaluateWinbackEligibility({ ...base, isSecurity: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('securities_excluded'))
})

t('opt-out / DNC suppresses (shared suppression, §12)', () => {
  const r = evaluateWinbackEligibility({ ...base, optedOut: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('opted_out'))
})

t('a non-candidate stage is excluded', () => {
  const r = evaluateWinbackEligibility({ ...base, stage: 'placed_issued' })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('not_candidate'))
})

t('a fresh (not-yet-stale) candidate is excluded', () => {
  const r = evaluateWinbackEligibility({ ...base, staleDays: 10 })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('not_stalled'))
})

t('an active advisor-owned opportunity outranks win-back (precedence #1)', () => {
  const r = evaluateWinbackEligibility({ ...base, hasActiveAdvisorOpportunity: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('active_advisor_opportunity'))
})

t('an upcoming appointment suppresses', () => {
  const r = evaluateWinbackEligibility({ ...base, hasUpcomingAppointment: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('active_appointment'))
})

t('an active conversation suppresses', () => {
  const r = evaluateWinbackEligibility({ ...base, inActiveConversation: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('in_conversation'))
})

t('a live enrollment blocks a duplicate (§4a)', () => {
  const r = evaluateWinbackEligibility({ ...base, priorEnrollmentActive: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('duplicate_active'))
})

t('all four §7 stalled stages + lost are candidates', () => {
  assert.deepEqual([...WINBACK_CANDIDATE_STAGES].sort(), ['application', 'fact_find', 'lost', 'prospect', 'quoted_proposed'])
})

console.log('winbackCategory — reason label from stage')

t('maps each candidate stage to its category', () => {
  assert.equal(winbackCategory('lost'), 'lost')
  assert.equal(winbackCategory('quoted_proposed'), 'stalled_quote')
  assert.equal(winbackCategory('application'), 'abandoned_application')
  assert.equal(winbackCategory('prospect'), 'inactive')
  assert.equal(winbackCategory('fact_find'), 'inactive')
  assert.equal(winbackCategory('placed_issued'), null)
})

console.log('\nclassifyRecheckOutcome — a failed pre-touch recheck maps to the enrollment next-state (ADR-018)')

t('securities/opt-out at recheck → SUPPRESS (terminal), even alongside a conversation', () => {
  assert.equal(classifyRecheckOutcome(['securities_excluded']), 'suppressed')
  assert.equal(classifyRecheckOutcome(['opted_out', 'in_conversation']), 'suppressed')
})

t('a newly-open customer conversation with no terminal reason → PAUSE (resumable, not stranded)', () => {
  assert.equal(classifyRecheckOutcome(['in_conversation']), 'paused_for_conversation')
})

t('an advisor now owning it (appointment / advisor-opp) → EXIT even if a conversation is open', () => {
  assert.equal(classifyRecheckOutcome(['in_conversation', 'active_appointment']), 'exited')
  assert.equal(classifyRecheckOutcome(['in_conversation', 'active_advisor_opportunity']), 'exited')
})

t('no-longer-a-candidate (won/deleted/un-stalled) → EXIT', () => {
  assert.equal(classifyRecheckOutcome(['no_longer_eligible']), 'exited')
  assert.equal(classifyRecheckOutcome(['not_candidate']), 'exited')
})

console.log(`\n✓ pipeline-winback eligibility: ${passed} assertions passed`)
