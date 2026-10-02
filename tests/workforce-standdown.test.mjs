// AI workforce stand-down and one-time first touch (owner decision 7, docs/ops/automation-inventory.md
// §10). Proves the PURE outreach core plus static invariants on the DB orchestrator:
//   • cross_sell / term_conversion / life_winback stand down — the campaign engines own those audiences;
//   • a referral first touch is ONE-TIME (durable record), never for a referral older than 14 days,
//     and never after a booking or a recent reply — excluded candidates roll the quota forward;
//   • dispatch sends only to the member the row was built for (consent is read for that member);
//   • a successful referral first touch stamps referrals.first_touch_at.
// Audit F-01 / F-02 / F-04 / F-07 / D-03 / E-02 / E-03 / H-01 / I-01.
// Run: node tests/workforce-standdown.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-wf-standdown-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
execSync(`npx tsc src/lib/ai/outreach.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`, { stdio: 'inherit' })
const require = createRequire(import.meta.url)
const { isCampaignEngineOwned, referralFirstTouchExclusion, selectForQuota, isSelectable, REFERRAL_MAX_AGE_DAYS } = require(join(out, 'outreach.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }
const cand = (id, over = {}) => ({
  source: 'referral_followup', agentKey: 'referral_followup', entityType: 'referral', entityId: id,
  householdId: 'hh', memberId: 'm-' + id, channel: 'sms', contactable: true, hasConsent: true, onDNC: false,
  suppressed: false, isSecurity: false, signal: { ageHours: 2 }, reason: 'r', recipientName: 'Sam', ...over,
})
const fresh = { ageDays: 1, alreadyTouched: false, upcomingAppointment: false, recentInbound: false }

console.log('Campaign engines own term conversion, cross-sell and win-back')
t('cross_sell, term_conversion and life_winback stand down; referral_followup does not', () => {
  assert.equal(isCampaignEngineOwned('cross_sell'), true)
  assert.equal(isCampaignEngineOwned('term_conversion'), true)
  assert.equal(isCampaignEngineOwned('life_winback'), true)
  assert.equal(isCampaignEngineOwned('referral_followup'), false)
})

console.log('\nReferral first touch is one-time, fresh, and stops on booking/reply')
t('a fresh, untouched, unbooked, quiet referral may be touched', () => assert.equal(referralFirstTouchExclusion(fresh), null))
t('already touched → excluded (one-time per target per workflow)', () => assert.equal(referralFirstTouchExclusion({ ...fresh, alreadyTouched: true }), 'first_touch_already_sent'))
t(`older than ${REFERRAL_MAX_AGE_DAYS} days → excluded`, () => {
  assert.equal(REFERRAL_MAX_AGE_DAYS, 14)
  assert.equal(referralFirstTouchExclusion({ ...fresh, ageDays: 14.01 }), 'referral_older_than_14_days')
  assert.equal(referralFirstTouchExclusion({ ...fresh, ageDays: 14 }), null)
})
t('unknown age (no received_at) → excluded, never guessed young', () => assert.equal(referralFirstTouchExclusion({ ...fresh, ageDays: Infinity }), 'referral_older_than_14_days'))
t('booked → excluded', () => assert.equal(referralFirstTouchExclusion({ ...fresh, upcomingAppointment: true }), 'appointment_booked'))
t('recent reply → excluded', () => assert.equal(referralFirstTouchExclusion({ ...fresh, recentInbound: true }), 'recent_reply'))
t('an excluded candidate is skipped with its reason and the quota rolls to the next one', () => {
  const sel = selectForQuota([cand('a', { exclusionReason: 'first_touch_already_sent' }), cand('b')], 1)
  assert.deepEqual(sel.selected.map((c) => c.entityId), ['b'])
  assert.equal(sel.skipped[0].reason, 'first_touch_already_sent')
  assert.equal(isSelectable(cand('c', { exclusionReason: 'recent_reply' })), false)
})

console.log('\nOrchestrator wiring (static invariants on src/lib/ai/workforce.ts)')
const wf = readFileSync('src/lib/ai/workforce.ts', 'utf8')
t('buildQueue skips campaign-engine-owned agents', () => assert.match(wf, /if \(isCampaignEngineOwned\(agentKey\)\) \{ byAgent\[agentKey\] = \{ queued: 0, skipped: 0 \}; continue \}/))
t('dispatch retires any queued row of an owned agent instead of sending it', () => assert.match(wf, /block_reason: 'campaign_engine_owns'/))
t('dispatch pins the recipient to the queued member', () => assert.match(wf, /resolveRecipient\(item\.household_id, item\.channel, null, item\.member_id\)/))
t('a sent referral first touch stamps referrals.first_touch_at (conditional, audited)', () => {
  assert.match(wf, /from\('referrals'\)\.update\(\{ first_touch_at: nowISO, updated_at: nowISO \}\)\.eq\('id', item\.entity_id\)\.is\('first_touch_at', null\)/)
})
t('referral exclusion lookups fail closed', () => {
  for (const fn of ['referralAlreadyTouched', 'householdHasUpcomingAppointment', 'memberRepliedWithin']) {
    const body = wf.slice(wf.indexOf(`async function ${fn}`), wf.indexOf('\n}\n', wf.indexOf(`async function ${fn}`)))
    assert.match(body, /if \(error\) return true/, fn)
  }
})
console.log(`\nAll ${passed} assertions passed.`)
