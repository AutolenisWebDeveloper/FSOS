// THE DISPATCH CHOKEPOINT — flag-gated recipient-local quiet hours, fail-closed timezone,
// configured windows, and the no-bare-{ok:false} escalation contract (messaging.ts +
// dispatch-policy.ts + gate.ts, all REAL; only the DB readers and providers stubbed).
//
// The failure mode this file is written against is FALSE GREEN: asserting a block without
// proving the check ran. Every case therefore also asserts the OBSERVABLE side of the
// mechanism — which reader was consulted, what the timezone resolution recorded, which
// scope key was loaded — so a short-circuit that skips the check fails the test even if it
// happens to produce the same verdict.
//
// Run: node tests/dispatch-chokepoint.test.mjs
import assert from 'node:assert/strict'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'

withProviderEnv()
const mod = loadChokepoint('chokepoint')

// Fixed instants (never the wall clock).
//   NOON:   18:00 UTC → 12:00 America/Chicago, 10:00 America/Los_Angeles, 13:00 New_York.
//   LATE:   04:00 UTC → 22:00 (prev day) Chicago, 20:00 Los_Angeles, 23:00 New_York.
//   LA_EVE: 02:30 UTC → 20:30 (prev day) Chicago, 18:30 Los_Angeles.
const NOON = new Date(Date.UTC(2026, 0, 15, 18, 0))
const LATE = new Date(Date.UTC(2026, 0, 15, 4, 0))
const LA_EVE = new Date(Date.UTC(2026, 0, 15, 2, 30))

const CLEAN = 'Your annual review window is open — reply to schedule.'

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

function smsTo(phone, state = {}, policy = {}, now = NOON) {
  const { messagingDeps, calls, seen } = makeMessagingDeps(mod, state, { now })
  return mod.messaging
    .sendSms(phone, CLEAN, 'mid-x', {
      policy: {
        actor: 'agent:test', entity: { type: 'household', id: 'h1' },
        purpose: 'MARKETING', templateKind: 'stored', templateId: 't1',
        ...policy,
      },
    }, messagingDeps)
    .then((r) => ({ r, calls, seen }))
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('CODE DEFAULT — recipient-local with no env flag (owner decision 1)')
delete process.env.QUIET_HOURS_RECIPIENT_LOCAL

// NOON_ALL: 21:00 UTC → 16:00 New_York, 15:00 Chicago, 14:00 Denver/Phoenix, 13:00 Los_Angeles —
// inside the floor in every continental zone.
const NOON_ALL = new Date(Date.UTC(2026, 0, 15, 21, 0))

await t('with QUIET_HOURS_RECIPIENT_LOCAL unset, the RECIPIENT zone is used (not America/Chicago)', async () => {
  const { r } = await smsTo('+13105550147', {}, {}, LA_EVE)
  assert.equal(r.ok, true, '18:30 Los Angeles is inside the floor')
  assert.equal(r.timezone.zone, 'America/Los_Angeles')
  assert.equal(r.timezone.legacy, false, 'the legacy fixed-zone path is no longer the default')
})

// EARLY_PT: 15:00 UTC → 10:00 New_York (inside) but 07:00 Los_Angeles (outside).
const EARLY_PT = new Date(Date.UTC(2026, 0, 15, 15, 0))
await t('UNRESOLVABLE zone → evaluated in EVERY continental zone: 07:00 Pacific is outside the floor → held', async () => {
  const { r, calls } = await smsTo('+13575550147', { recipientLocation: { phone: null, zip: null } }, {}, EARLY_PT)
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'quiet_hours', 'a floor verdict, not the old blanket timezone_unresolved block')
  assert.equal(calls.sms.length, 0, 'provider never reached')
  assert.match(r.reason, /every continental US zone/)
})

await t('UNRESOLVABLE zone at an instant inside the floor in ALL continental zones → sends', async () => {
  const { r } = await smsTo('+13575550147', { recipientLocation: { phone: null, zip: null } }, {}, NOON_ALL)
  assert.equal(r.ok, true)
})

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nRecipient-local resolution (the env flag no longer changes anything)')
process.env.QUIET_HOURS_RECIPIENT_LOCAL = 'false'
await t('setting the env flag to false does NOT bring back the fixed Chicago zone', async () => {
  const { r } = await smsTo('+12125550147', {}, {}, LATE)
  assert.equal(r.ok, false, '23:00 New York is outside the floor even with the flag "false"')
  assert.equal(r.timezone.zone, 'America/New_York')
})
process.env.QUIET_HOURS_RECIPIENT_LOCAL = 'true'

await t('the SAME send now evaluates in the RECIPIENT’s zone (LA evening sends; Chicago would have blocked)', async () => {
  const { r } = await smsTo('+13105550147', {}, {}, LA_EVE)
  assert.equal(r.ok, true, '18:30 recipient-local is inside the floor')
  assert.equal(r.timezone.zone, 'America/Los_Angeles')
  assert.equal(r.timezone.resolution.method, 'npa')
  assert.equal(r.timezone.resolution.input, '310', 'the NPA used is recorded for the send record')
})

await t('an East-coast recipient at 23:00 local is blocked even though it is 22:00 agency time', async () => {
  const { r } = await smsTo('+12125550147', {}, {}, LATE)
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'quiet_hours')
  assert.equal(r.timezone.zone, 'America/New_York')
})

await t('an unresolvable phone with a household ZIP resolves from the ADDRESS', async () => {
  const { r } = await smsTo('+13575550147', { recipientLocation: { phone: null, zip: '90001' } }, {}, LA_EVE)
  assert.equal(r.ok, true, 'ZIP resolved Los Angeles; 18:30 local sends')
  assert.equal(r.timezone.resolution.method, 'zip')
  assert.equal(r.timezone.resolution.input, '900')
})

await t('EMAIL with no floor and no configured window needs no timezone — an unresolvable one does not block', async () => {
  const { messagingDeps, calls } = makeMessagingDeps(mod, { recipientLocation: { phone: null, zip: null } }, { now: NOON })
  const r = await mod.messaging.sendEmail('lee@example.com', 'Note', '<p>Your receipt.</p>', undefined, {
    policy: { actor: 'system:test', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional', suppressible: false },
  }, messagingDeps)
  assert.equal(r.ok, true, 'nothing would have used the zone; blocking would break every transactional email')
  assert.equal(calls.email.length, 1)
})

await t('a caller-resolved zone (workshop engine) WINS over the map in both flag states', async () => {
  const { r } = await smsTo('+12125550147', {}, { timeZone: 'America/Denver' }, NOON)
  assert.equal(r.ok, true)
  assert.equal(r.timezone.zone, 'America/Denver', 'caller resolution is strictly better information')
})

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nConfigured windows — loaded by scope key, narrow only, defer not suppress')

await t('a campaign window is loaded under campaign:<key> and NARROWS the floor', async () => {
  const { r, seen } = await smsTo('+12145550147', {
    hoursWindows: { 'campaign:life_conversion': { startHour: 13, endHour: 18, days: [0, 1, 2, 3, 4, 5, 6] } },
  }, { campaignKey: 'life_conversion' }, NOON) // 12:00 recipient-local
  assert.deepEqual(seen.hoursWindow, ['campaign:life_conversion'], 'the scoped row was actually loaded')
  assert.equal(r.ok, false, '12:00 is inside the floor but outside 13–18')
  assert.equal(r.blockedStep, 'configured_window')
  assert.equal(r.escalated, false, 'a DEFERRAL — never a compliance escalation')
})

await t('a WIDER campaign window cannot widen the floor (brief case: 7–22 ∩ floor → floor)', async () => {
  const { r } = await smsTo('+12125550147', {
    hoursWindows: { 'campaign:c1': { startHour: 7, endHour: 22, days: [0, 1, 2, 3, 4, 5, 6] } },
  }, { campaignKey: 'c1' }, LATE) // 23:00 New York local
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'quiet_hours', 'still the statutory floor, still escalating')
  assert.equal(r.escalated, true)
})

await t('worker window applies under agent:<key> for an AI-worker send', async () => {
  const { r, seen } = await smsTo('+12145550147', {
    hoursWindows: { 'agent:cross_sell': { startHour: 14, endHour: 18, days: [0, 1, 2, 3, 4, 5, 6] } },
  }, { workerKey: 'cross_sell' }, NOON)
  assert.deepEqual(seen.hoursWindow, ['agent:cross_sell'])
  assert.equal(r.blockedStep, 'configured_window')
})

await t('EXEMPT PURPOSE (APPOINTMENT) + configured window + out-of-window → DEFERRED, not suppressed', async () => {
  const { r, calls } = await smsTo('+12145550147', {
    hoursWindows: { 'campaign:term_conv': { startHour: 14, endHour: 18, days: [0, 1, 2, 3, 4, 5, 6] } },
  }, { campaignKey: 'term_conv', purpose: 'APPOINTMENT', suppressible: false }, NOON)
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'configured_window', 'the deferral step, never suppression')
  assert.equal(r.escalated, false)
  assert.equal(calls.escalate[0].outcome.escalate, false, 'audited as a deferral')
  assert.match(r.reason, /deferred to the next opening/, 'the deferral names its recovery')
})

await t('EXEMPT PURPOSE (person-triggered APPOINTMENT notice) with NO configured window is untouched', async () => {
  const { r } = await smsTo('+12145550147', {}, { purpose: 'APPOINTMENT', recipientTriggeredNotice: true, suppressible: false }, LATE)
  assert.equal(r.ok, true, '22:00 local sends — an immediate, person-triggered appointment notice has no floor')
  const { r: undeclared } = await smsTo('+12145550147', {}, { purpose: 'APPOINTMENT', suppressible: false }, LATE)
  assert.equal(undeclared.ok, false, 'follow-up R3: an undeclared APPOINTMENT-tagged SMS keeps the floor')
})

await t('owner decision 2: POLICY_DEADLINE (Life Conversion / term conversion) SMS now keeps the floor', async () => {
  const { r } = await smsTo('+12145550147', {}, { purpose: 'POLICY_DEADLINE', suppressible: false }, LATE)
  assert.equal(r.ok, false, '22:00 local is outside the floor')
  assert.equal(r.blockedStep, 'quiet_hours')
})

await t('a campaign-keyed send tagged with an exempt purpose and an UNKNOWN zone must hold in every continental zone', async () => {
  const { r } = await smsTo('+13575550147', {
    hoursWindows: { 'campaign:term_conv': { startHour: 9, endHour: 20, days: [0, 1, 2, 3, 4, 5, 6] } },
  }, { campaignKey: 'term_conv', purpose: 'APPOINTMENT', suppressible: false }, EARLY_PT)
  assert.equal(r.ok, false, '07:00 Pacific is outside the floor in one continental zone')
  // Follow-up R3: a campaign-keyed send keeps the statutory floor whatever its purpose, so the floor
  // (quiet_hours) is now the verdict ahead of the configured window.
  assert.equal(r.blockedStep, 'quiet_hours')
})

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nEmpty intersection — a window that can NEVER open escalates, never defers forever')

await t('EMPTY INTERSECTION (campaign 7–9 ∩ floor 9–20, Honolulu recipient) → window_misconfigured ESCALATES', async () => {
  // 18:00 recipient-local (inside the floor, so the floor itself is not the verdict) with a
  // configured window that cannot overlap the floor at ANY hour. There is no next opening a
  // deferral could wait for — retrying forever with nobody seeing it is the failure mode.
  const { r, calls } = await smsTo('+18085550147', {
    hoursWindows: { 'campaign:early_bird': { startHour: 7, endHour: 9, days: [0, 1, 2, 3, 4, 5, 6] } },
  }, { campaignKey: 'early_bird' }, LATE) // 04:00 UTC → 18:00 Pacific/Honolulu
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'window_misconfigured', 'its OWN step — separable from configured_window and quiet_hours')
  assert.equal(r.escalated, true, 'a config error with no self-clearing condition must reach a human')
  assert.equal(calls.escalate.length, 1)
  assert.equal(calls.escalate[0].outcome.escalate, true)
  assert.equal(calls.sms.length, 0, 'provider never reached')
  assert.match(r.reason, /never overlap/, 'the reason names the misconfiguration, not a generic block')
})

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nAddress first, then area code (owner decision 1)')

await t('phone and ZIP AGREE: the address zone is used (method zip)', async () => {
  const { r } = await smsTo('+12145550147', { recipientLocation: { phone: '+12145550147', zip: '75201' } }, {}, NOON)
  assert.equal(r.ok, true, '12:00 America/Chicago')
  assert.equal(r.timezone.zone, 'America/Chicago')
  assert.equal(r.timezone.resolution.method, 'zip')
  assert.equal(r.timezone.secondaryZone ?? null, null)
})

await t('phone and ZIP DISAGREE: the address zone is never dropped (Dallas 20:30 → held, though LA is 18:30)', async () => {
  const { r, calls } = await smsTo('+13105550147', { recipientLocation: { phone: '+13105550147', zip: '75201' } }, {}, LA_EVE)
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'quiet_hours')
  assert.equal(calls.sms.length, 0)
  assert.equal(r.timezone.secondaryZone, 'America/Chicago', 'the address zone is evaluated')
  assert.equal(r.timezone.resolution.method, 'both')
})

console.log('\nPhone and address zones disagree: inside the floor in BOTH (review finding 3a)')

await t('Dallas address 09:00, Los Angeles phone 07:00 → held (the address zone alone would send)', async () => {
  const { r, calls } = await smsTo('+13105550147', { recipientLocation: { phone: '+13105550147', zip: '75201' } }, {}, EARLY_PT)
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'quiet_hours')
  assert.equal(calls.sms.length, 0, 'provider never reached')
  // Recorded in migration 124's dual-zone form: '<npaZone>+<zipZone>', method 'both', input '<npa>+<zip3>'.
  assert.equal(r.timezone.zone, 'America/Los_Angeles')
  assert.equal(r.timezone.secondaryZone, 'America/Chicago')
  assert.equal(r.timezone.resolution.method, 'both')
  assert.equal(r.timezone.resolution.input, '310+752')
})

await t('Los Angeles address 18:30, Dallas phone 20:30 → held', async () => {
  const { r, calls } = await smsTo('+12145550147', { recipientLocation: { phone: '+12145550147', zip: '90012' } }, {}, LA_EVE)
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'quiet_hours')
  assert.equal(calls.sms.length, 0)
  assert.equal(r.timezone.zone, 'America/Chicago')
  assert.equal(r.timezone.secondaryZone, 'America/Los_Angeles')
})

await t('inside the floor in both zones → sent, and both zones are recorded', async () => {
  const { r, calls } = await smsTo('+13105550147', { recipientLocation: { phone: '+13105550147', zip: '75201' } }, {}, NOON)
  assert.equal(r.ok, true, '12:00 Chicago and 10:00 Los Angeles')
  assert.equal(calls.sms.length, 1)
  assert.equal(r.timezone.zone, 'America/Los_Angeles')
  assert.equal(r.timezone.secondaryZone, 'America/Chicago')
})

await t('an unresolvable area code next to a resolved address does not add a zone', async () => {
  const { r } = await smsTo('+13575550147', { recipientLocation: { phone: '+13575550147', zip: '75201' } }, {}, NOON)
  assert.equal(r.timezone.zone, 'America/Chicago')
  assert.equal(r.timezone.secondaryZone, null)
})

await t('no ZIP on file: the AREA CODE zone is used (method npa)', async () => {
  const { r } = await smsTo('+13105550147', { recipientLocation: { phone: '+13105550147', zip: null } }, {}, LA_EVE)
  assert.equal(r.ok, true)
  assert.equal(r.timezone.zone, 'America/Los_Angeles')
  assert.equal(r.timezone.resolution.method, 'npa')
})

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nEscalation contract — no bare {ok:false} anywhere')

await t('every policy withhold carries blockedStep + reason + escalated and hits the escalation path', async () => {
  const cases = [
    [{ onDNC: true }, {}, NOON],
    [{ memberConsent: false, contactConsent: false }, {}, NOON],
    [{ templateApproved: false }, {}, NOON],
    [{}, {}, LATE],
  ]
  for (const [state, policy, now] of cases) {
    const { r, calls } = await smsTo('+12145550147', state, policy, now)
    assert.equal(r.ok, false)
    assert.ok(r.blockedStep, 'blockedStep always present')
    assert.ok(r.reason, 'reason always present')
    assert.equal(typeof r.escalated, 'boolean')
    assert.equal(calls.escalate.length, 1, 'the escalation path always runs on a withhold')
  }
})

await t('even a CONFIGURATION failure is audited, never a silent false', async () => {
  const OLD = process.env.TWILIO_ACCOUNT_SID
  delete process.env.TWILIO_ACCOUNT_SID
  try {
    const { r, calls } = await smsTo('+12145550147', {}, {}, NOON)
    assert.equal(r.ok, false)
    assert.equal(r.blockedStep, 'not_configured')
    assert.equal(calls.escalate.length, 1, 'the audit path still runs')
    assert.equal(calls.escalate[0].outcome.escalate, false, 'an env problem is operational, not compliance')
  } finally {
    process.env.TWILIO_ACCOUNT_SID = OLD
  }
})

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nsmsConfigured() — the readiness surfaces and the sender agree, exhaustively')

// The readiness surfaces (/api/health, the super health page, /api/forms/send) each kept
// their own copy of "is SMS configured", and three of them demanded TWILIO_PHONE_NUMBER
// specifically. A Messaging-Service-only deployment — the PREFERRED Twilio setup, since the
// service carries the number pool and carrier opt-out handling — could therefore place SMS
// successfully while every readiness surface reported it unconfigured. They now call this
// one exported predicate. What makes that safe is not that the copies were deleted but that
// the survivor agrees with what sendSms ACTUALLY enforces, so drive all 16 combinations of
// the four env vars through the real sender and compare.
await t('smsConfigured() equals sendSms\'s real precondition for all 16 env combinations', async () => {
  const KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TWILIO_MESSAGING_SERVICE_SID']
  const VALUES = { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'token', TWILIO_PHONE_NUMBER: '+15550000', TWILIO_MESSAGING_SERVICE_SID: 'MGtest' }
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  const rows = []
  try {
    for (let mask = 0; mask < 16; mask++) {
      for (const [i, k] of KEYS.entries()) {
        if (mask & (1 << i)) process.env[k] = VALUES[k]
        else delete process.env[k]
      }
      const claimed = mod.messaging.smsConfigured()
      const { r } = await smsTo('+12145550147', {}, {}, NOON)
      // `not_configured` is the LAST gate sendSms applies, so a send that gets past it is
      // proof the env satisfied the sender. Any other block would mean the case never
      // reached the config check and the comparison would be vacuous.
      const senderBlocked = r.blockedStep === 'not_configured'
      assert.notEqual(r.blockedStep, 'sms_live', 'guard: the A2P hold must not preempt the config check')
      assert.equal(
        claimed, !senderBlocked,
        `env ${KEYS.filter((_, i) => mask & (1 << i)).join('+') || '(none)'}: smsConfigured()=${claimed} but sendSms ${senderBlocked ? 'blocked not_configured' : 'accepted'}`,
      )
      rows.push({ mask, claimed })
    }
  } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
  // Guard against a vacuous truth table: both verdicts must actually occur, or the loop
  // above would pass against a predicate hardwired to a constant.
  assert.ok(rows.some((x) => x.claimed) && rows.some((x) => !x.claimed), 'both verdicts must occur')
})

await t('a MESSAGING-SERVICE-ONLY deployment reports ready — the specific case the old copies got wrong', async () => {
  const saved = { p: process.env.TWILIO_PHONE_NUMBER, m: process.env.TWILIO_MESSAGING_SERVICE_SID }
  try {
    delete process.env.TWILIO_PHONE_NUMBER
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MGtest'
    assert.equal(mod.messaging.smsConfigured(), true, 'a Messaging Service alone is a complete SMS sender')
    const { r } = await smsTo('+12145550147', {}, {}, NOON)
    assert.notEqual(r.blockedStep, 'not_configured', 'and the sender agrees — it does not demand a from-number')

    // The converse: a from-number alone is equally complete. Neither sender is privileged.
    process.env.TWILIO_PHONE_NUMBER = '+15550000'
    delete process.env.TWILIO_MESSAGING_SERVICE_SID
    assert.equal(mod.messaging.smsConfigured(), true)

    // Neither → not ready. SID + token alone cannot place a message.
    delete process.env.TWILIO_PHONE_NUMBER
    assert.equal(mod.messaging.smsConfigured(), false, 'credentials without any sender are NOT ready')
  } finally {
    if (saved.p === undefined) delete process.env.TWILIO_PHONE_NUMBER; else process.env.TWILIO_PHONE_NUMBER = saved.p
    if (saved.m === undefined) delete process.env.TWILIO_MESSAGING_SERVICE_SID; else process.env.TWILIO_MESSAGING_SERVICE_SID = saved.m
  }
})

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nMigration 123 — static guarantees (storage for the above)')

await t('mig 123: additive only, scoped-id CHECK, tz columns with method CHECK, no destructive statement', async () => {
  const { readFileSync } = await import('node:fs')
  const mig = readFileSync('supabase/migrations/123_scoped_hours_and_tz_resolution.sql', 'utf8')
  assert.ok(/comm_hours_policy_scope_shape/.test(mig), 'scope-shape CHECK present')
  assert.ok(/id = 'global' or id like 'agent:%' or id like 'campaign:%'/.test(mig), 'only known scope shapes')
  assert.ok(/add column if not exists resolved_timezone/.test(mig), 'resolved_timezone column')
  assert.ok(/tz_resolution_method in \('npa', 'zip'\)/.test(mig), 'method constrained to npa|zip')
  assert.ok(/add column if not exists tz_resolution_input/.test(mig), 'resolution input column')
  assert.ok(!/drop table|truncate|delete from/i.test(mig), 'no destructive statement')
  assert.ok(!/insert into comm_hours_policy.*agent:|insert into comm_hours_policy.*campaign:/i.test(mig),
    'no seeded scoped window — a narrowing nobody configured must not hold real sends')
})

await t('mig 124: method CHECK widened to npa|zip|both, additive only, existing rows unaffected', async () => {
  const { readFileSync } = await import('node:fs')
  const mig = readFileSync('supabase/migrations/124_tz_resolution_method_both.sql', 'utf8')
  assert.ok(/drop constraint if exists comm_messages_tz_resolution_method_check/.test(mig), 're-created, not stacked')
  assert.ok(/tz_resolution_method in \('npa', 'zip', 'both'\)/.test(mig), "the CHECK admits 'both'")
  assert.ok(/or tz_resolution_method is null/.test(mig), 'null (caller/legacy resolution) still valid')
  assert.ok(!/drop table|truncate|delete from|drop column/i.test(mig), 'no destructive statement')
})

process.env.QUIET_HOURS_RECIPIENT_LOCAL = ''
console.log(`\nAll ${passed} assertions passed.`)
