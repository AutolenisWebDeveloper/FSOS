// Review finding 3b (owner, 2026-10-02): automated SMS goes only to US numbers. Numbers outside the
// US — including +1 numbers in Canada and the Caribbean — are a hard block; a number that cannot be
// shown to be in the US (non-geographic, unparseable) is treated the same way (fail closed). US
// territories are the US. A US area code with no mapped zone keeps decision 1 (continental
// intersection). Operator-initiated 1:1 sends are not automated and are not blocked by this step.
// Proven through the REAL chokepoint (messaging.ts → dispatch-policy.ts → gate.ts), DB stubbed.
// Run: node tests/recipient-country.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'

withProviderEnv()
const mod = loadChokepoint('recipient-country')
const { recipientCountry, NON_US_NANP_NPAS } = createRequire(import.meta.url)(join(mod.out, 'lib/comms/recipient-timezone.js'))

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

// 21:00 UTC (January): 16:00 New_York … 13:00 Los_Angeles, 17:00 Atlantic — inside every floor.
const MIDDAY = new Date(Date.UTC(2026, 0, 15, 21, 0))
const CLEAN = 'Your annual review window is open — reply to schedule.'

function send(channel, to, policy = {}, state = {}) {
  const { messagingDeps, calls } = makeMessagingDeps(mod, state, { now: MIDDAY })
  const opts = {
    policy: { actor: 'agent:test', entity: { type: 'household', id: 'h1' }, purpose: 'MARKETING', templateKind: 'stored', templateId: 't1', ...policy },
  }
  const p = channel === 'sms'
    ? mod.messaging.sendSms(to, CLEAN, 'mid-x', opts, messagingDeps)
    : mod.messaging.sendEmail(to, 'Subject', '<p>' + CLEAN + '</p>', CLEAN, opts, messagingDeps)
  return p.then((r) => ({ r, calls }))
}

console.log('recipientCountry() — pure classification')
await t('US states, DC and the territories are the US', () => {
  for (const p of ['+12145550147', '+12025550147', '+17875550147', '+13405550147', '+16715550147', '+16705550147', '+16845550147', '+19075550147', '+18085550147']) {
    assert.equal(recipientCountry(p).us, true, p)
  }
})
await t('Canada is not the US (every listed code, incl. the newest overlays and 600/622/633)', () => {
  assert.equal(NON_US_NANP_NPAS.CA.length, 63, '56 geographic + non-geographic 600/622/633/644/655/677/688')
  for (const npa of NON_US_NANP_NPAS.CA) {
    const r = recipientCountry(`+1${npa}5550147`)
    assert.equal(r.us, false, npa)
    assert.equal(r.kind, 'non_us')
    assert.equal(r.country, 'CA')
  }
  for (const npa of ['416', '604', '263', '273', '428', '879', '942']) assert.ok(NON_US_NANP_NPAS.CA.includes(npa), npa)
})
await t('every Caribbean / Bermuda +1 code is not the US', () => {
  const codes = Object.entries(NON_US_NANP_NPAS).filter(([c]) => c !== 'CA')
  assert.equal(codes.length, 18)
  for (const [country, npas] of codes) for (const npa of npas) {
    const r = recipientCountry(`+1${npa}5550147`)
    assert.equal(r.us, false, npa)
    assert.equal(r.country, country)
  }
  for (const npa of ['809', '829', '849', '876', '658', '441', '242', '868']) assert.equal(recipientCountry(`1${npa}5550147`).us, false, npa)
})
await t('no US territory code is on the non-US list', () => {
  const all = Object.values(NON_US_NANP_NPAS).flat()
  for (const npa of ['787', '939', '340', '671', '670', '684']) assert.ok(!all.includes(npa), npa)
})
await t('a non-+1 international number is not the US', () => {
  for (const p of ['+447911123456', '+5215512345678', '+61412345678']) {
    const r = recipientCountry(p)
    assert.equal(r.us, false, p)
    assert.equal(r.country, 'intl')
  }
})
await t('toll-free / non-geographic and unparseable numbers cannot be shown US → not US (fail closed)', () => {
  for (const p of ['+18005550147', '+18885550147', '+15005550147', '+19005550147']) {
    const r = recipientCountry(p)
    assert.equal(r.us, false, p)
    assert.equal(r.kind, 'unverifiable')
  }
  for (const p of ['', null, undefined, '555-0147', '+1 011 555 0147']) assert.equal(recipientCountry(p).us, false, String(p))
})
await t('a US-form area code with no mapped zone is still US (decision 1 then applies)', () => {
  const r = recipientCountry('+13575550147') // 357: US-form, not on either list, no mapped zone
  assert.equal(r.us, true)
})

console.log('\nThrough the chokepoint — automated SMS')
await t('automated SMS to a Canadian number → hard, escalating block; provider never reached', async () => {
  const { r, calls } = await send('sms', '+14165550147')
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'non_us_recipient')
  assert.equal(r.escalated, true)
  assert.match(r.reason, /CA, not the US/)
  assert.equal(calls.sms.length, 0)
})
await t('automated SMS to a Dominican Republic and a UK number → blocked', async () => {
  for (const to of ['+18095550147', '+447911123456']) {
    const { r, calls } = await send('sms', to)
    assert.equal(r.blockedStep, 'non_us_recipient', to)
    assert.equal(calls.sms.length, 0)
  }
})
await t('automated SMS to a toll-free number → blocked (country cannot be established)', async () => {
  const { r } = await send('sms', '+18005550147')
  assert.equal(r.blockedStep, 'non_us_recipient')
})
await t('automated SMS of an exempt purpose (APPOINTMENT) to Canada is still blocked', async () => {
  const { r } = await send('sms', '+16045550147', { purpose: 'APPOINTMENT' })
  assert.equal(r.blockedStep, 'non_us_recipient')
})
await t('automated SMS to a US number and to Puerto Rico are sent', async () => {
  for (const to of ['+12145550147', '+17875550147']) {
    const { r, calls } = await send('sms', to)
    assert.equal(r.ok, true, to)
    assert.equal(calls.sms.length, 1)
  }
})
await t('a US area code with no mapped zone keeps decision 1 (sent at an all-zone instant)', async () => {
  const { r } = await send('sms', '+13575550147', {}, { recipientLocation: { phone: '+13575550147', zip: null } })
  assert.equal(r.ok, true)
  assert.equal(r.timezone.resolution.resolved, false)
})

console.log('\nNot automated, or not SMS')
await t('an operator-initiated 1:1 SMS to Canada is not blocked by this step', async () => {
  const { r, calls } = await send('sms', '+14165550147', { operatorInitiated: true })
  assert.notEqual(r.blockedStep, 'non_us_recipient')
  assert.equal(r.ok, true)
  assert.equal(calls.sms.length, 1)
})
await t('email is unaffected', async () => {
  const { r } = await send('email', 'someone@example.ca')
  assert.notEqual(r.blockedStep, 'non_us_recipient')
})
await t('no consent → the consent step reports first (1a runs after step 1)', async () => {
  const { r } = await send('sms', '+14165550147', {}, { memberConsent: false, contactConsent: false })
  assert.equal(r.blockedStep, 'consent')
})

console.log('\nWho may declare operatorInitiated (static)')
const OPERATOR_SITES = [
  'src/app/api/comms/send/route.ts',
  'src/app/api/comms/test/route.ts',
  'src/app/api/comms/test/recipients/route.ts',
  'src/app/api/comms/conversations/[id]/route.ts',
  'src/app/api/forms/send/route.ts', // passes it to sendForm (src/lib/forms.ts forwards the caller's value)
]
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
await t('the public agency referral intake does not declare it (sendForm forwards the caller\'s value)', () => {
  assert.doesNotMatch(readFileSync('src/app/api/agencies/referral/route.ts', 'utf8'), /operatorInitiated/)
  assert.match(readFileSync('src/lib/forms.ts', 'utf8'), /operatorInitiated: input\.operatorInitiated === true/)
})
await t('conversation start: only an FSA-typed opener is operator-initiated, never a seeded asset', () => {
  const src = readFileSync('src/app/api/comms/conversations/start/route.ts', 'utf8')
  assert.match(src, /operatorInitiated: seededFrom === 'blank',/)
  assert.match(src, /seededFrom = 'approved_template'/)
})
await t('only the operator surfaces set operatorInitiated: true', () => {
  const setters = walk('src').filter((f) => /\.tsx?$/.test(f) && /operatorInitiated:\s*true/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(setters.sort(), [...OPERATOR_SITES].sort())
})

console.log(`\nAll ${passed} assertions passed.`)
