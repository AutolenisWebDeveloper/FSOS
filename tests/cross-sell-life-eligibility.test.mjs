// Cross-Sell Life Campaign — eligibility-gate proof (spec §3 / §5). Compiles the PURE gate
// (src/lib/cross-sell-life/eligibility.ts) in isolation (no Supabase) and asserts a fully-eligible
// client passes, each hard exclusion flips eligible→false with the correct reason, the soft
// cooldown blocks inside its window, and a force-override waives ONLY the cooldown while every hard
// reason survives (§4.1 firewall + population separation are never overridable).
// Run: node tests/cross-sell-life-eligibility.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-xsell-eligibility-'))
execSync(
  `npx tsc src/lib/cross-sell-life/eligibility.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateEligibility, blockingAfterOverride, OVERRIDABLE_REASONS } = require(join(out, 'eligibility.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// A fully-eligible EligibilityInput. Each test flips exactly ONE field.
function eligible(over = {}) {
  return {
    isSecurity: false,
    optedOut: false,
    hasActiveLifePolicy: false,
    hasActiveLifeApplication: false,
    hasActiveLifeOpportunity: false,
    inLifeConversion: false,
    inWinback: false,
    hasQualifyingRelationship: true,
    priorEnrollmentActive: false,
    hasValidContact: true,
    jurisdictionLicensed: true,
    deceased: false,
    onComplianceHold: false,
    hasLifeAppointment: false,
    advisorConversationActive: false,
    lastTerminalAt: null,
    cooldownDays: 365,
    now: '2026-07-31',
    ...over,
  }
}

console.log('Baseline')

t('a fully-eligible client returns eligible:true with no reasons', () => {
  const r = evaluateEligibility(eligible())
  assert.equal(r.eligible, true)
  assert.deepEqual(r.reasons, [])
})

console.log('Hard exclusions — each flips eligible:false with the correct reason')

// field override → expected reason
const HARD = [
  [{ isSecurity: true }, 'securities_excluded'],
  [{ optedOut: true }, 'opted_out'],
  [{ hasActiveLifePolicy: true }, 'has_active_life_policy'],
  [{ hasActiveLifeOpportunity: true }, 'has_active_life_opportunity'],
  [{ inLifeConversion: true }, 'in_life_conversion'],
  [{ inWinback: true }, 'in_winback'],
  [{ hasQualifyingRelationship: false }, 'no_qualifying_relationship'],
  [{ priorEnrollmentActive: true }, 'duplicate_active'],
  [{ hasValidContact: false }, 'no_valid_contact'],
  [{ jurisdictionLicensed: false }, 'outside_jurisdiction'],
  [{ hasLifeAppointment: true }, 'existing_life_appointment'],
]

for (const [over, reason] of HARD) {
  t(`${reason} → eligible:false`, () => {
    const r = evaluateEligibility(eligible(over))
    assert.equal(r.eligible, false)
    assert.ok(r.reasons.includes(reason), `expected reason "${reason}", got ${JSON.stringify(r.reasons)}`)
    // A single flipped field yields exactly its one reason.
    assert.deepEqual(r.reasons, [reason])
  })
}

console.log('Cooldown (soft) + override')

t('a terminal run inside the cooldown window blocks with "cooldown"', () => {
  // 30 days since a terminal, non-converting run, 365-day cooldown → still cooling.
  const r = evaluateEligibility(eligible({ lastTerminalAt: '2026-07-01', cooldownDays: 365, now: '2026-07-31' }))
  assert.equal(r.eligible, false)
  assert.deepEqual(r.reasons, ['cooldown'])
})

t('a terminal run OUTSIDE the cooldown window does not block', () => {
  const r = evaluateEligibility(eligible({ lastTerminalAt: '2025-01-01', cooldownDays: 365, now: '2026-07-31' }))
  assert.equal(r.eligible, true)
  assert.deepEqual(r.reasons, [])
})

t('cooldown is the only overridable reason', () => {
  assert.equal(OVERRIDABLE_REASONS.has('cooldown'), true)
  assert.equal(OVERRIDABLE_REASONS.has('securities_excluded'), false)
  assert.equal(OVERRIDABLE_REASONS.has('opted_out'), false)
})

t('blockingAfterOverride removes ONLY cooldown and keeps every hard reason', () => {
  const mixed = ['securities_excluded', 'opted_out', 'cooldown']
  assert.deepEqual(blockingAfterOverride(mixed, true), ['securities_excluded', 'opted_out'])
  // Without override nothing is waived.
  assert.deepEqual(blockingAfterOverride(mixed, false), mixed)
  // A pure-cooldown block clears entirely under override.
  assert.deepEqual(blockingAfterOverride(['cooldown'], true), [])
})

console.log(`\nAll ${passed} assertions passed.`)
