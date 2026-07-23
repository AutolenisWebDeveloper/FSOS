// Slice 2 — First-contact identity disclosure engine (§8). Proves the PURE decision
// core + renderer offline (no live Supabase), mirroring tests/guardrail.test.mjs.
//
//   • evaluateIdentityDisclosure decides whether a FULL introduction is required for a
//     given send, PER CHANNEL. A full intro is required on any §8 trigger (first-ever
//     touch on this channel, new campaign, new purpose, different sender, reassignment,
//     inactivity, "who is this?", or unconfirmable prior disclosure); otherwise the
//     approved ABBREVIATED identity form is allowed. It also computes the first-touch
//     flags persisted on the message.
//   • renderIdentityDisclosure fills the approved, CONFIGURABLE disclosure wording and
//     never fabricates the Farmers entity label (§4.3 — it comes from config).
//
// Run: node tests/comms-identity.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-identity-'))
execSync(
  `npx tsc src/lib/comms/identity.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateIdentityDisclosure, renderIdentityDisclosure } = require(join(out, 'identity.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// A baseline: an established thread, same sender, same purpose, recently disclosed.
const established = {
  channel: 'sms',
  priorDisclosedAt: '2026-07-20T12:00:00Z',
  now: '2026-07-23T12:00:00Z',
  inactivityDays: 30,
  channelAlreadyTouched: true,
  newCampaign: false,
  purposeChanged: false,
  senderChanged: false,
  reassignment: false,
  contactAskedWhoIsThis: false,
  priorDisclosureConfirmable: true,
}

console.log('evaluateIdentityDisclosure — full-intro triggers (§8)')

t('an established, unchanged thread → ABBREVIATED (no full intro)', () => {
  const r = evaluateIdentityDisclosure(established)
  assert.equal(r.fullIntroRequired, false)
  assert.equal(r.flags.isFirstChannelTouch, false)
})

t('first-ever touch on this channel → FULL intro', () => {
  const r = evaluateIdentityDisclosure({ ...established, channelAlreadyTouched: false, priorDisclosedAt: null })
  assert.equal(r.fullIntroRequired, true)
  assert.equal(r.flags.isFirstChannelTouch, true)
  assert.match(r.reason, /first/i)
})

t('per-channel: a prior EMAIL disclosure does NOT satisfy the first SMS (each channel needs its own)', () => {
  // channelAlreadyTouched is per-channel; the SMS channel has never been touched even
  // though the contact was emailed before → still a full intro on SMS.
  const r = evaluateIdentityDisclosure({ ...established, channel: 'sms', channelAlreadyTouched: false })
  assert.equal(r.fullIntroRequired, true)
})

t('first message in a NEW campaign → FULL intro', () => {
  const r = evaluateIdentityDisclosure({ ...established, newCampaign: true })
  assert.equal(r.fullIntroRequired, true)
  assert.match(r.reason, /campaign/i)
})

t('a NEW communication purpose → FULL intro', () => {
  const r = evaluateIdentityDisclosure({ ...established, purposeChanged: true })
  assert.equal(r.fullIntroRequired, true)
  assert.match(r.reason, /purpose/i)
})

t('a DIFFERENT sender → FULL intro', () => {
  const r = evaluateIdentityDisclosure({ ...established, senderChanged: true })
  assert.equal(r.fullIntroRequired, true)
  assert.match(r.reason, /sender/i)
})

t('after agency-owner / contact-owner REASSIGNMENT → FULL intro', () => {
  const r = evaluateIdentityDisclosure({ ...established, reassignment: true })
  assert.equal(r.fullIntroRequired, true)
  assert.match(r.reason, /reassign/i)
})

t('after the configured INACTIVITY period → FULL intro', () => {
  // last disclosed 40 days ago, inactivity window 30 days → stale → full intro.
  const r = evaluateIdentityDisclosure({
    ...established,
    priorDisclosedAt: '2026-06-13T12:00:00Z',
    now: '2026-07-23T12:00:00Z',
    inactivityDays: 30,
  })
  assert.equal(r.fullIntroRequired, true)
  assert.match(r.reason, /inactiv/i)
})

t('within the inactivity window → still ABBREVIATED', () => {
  const r = evaluateIdentityDisclosure({
    ...established,
    priorDisclosedAt: '2026-07-10T12:00:00Z', // 13 days ago < 30
    now: '2026-07-23T12:00:00Z',
    inactivityDays: 30,
  })
  assert.equal(r.fullIntroRequired, false)
})

t('the contact asked "who is this?" → FULL intro', () => {
  const r = evaluateIdentityDisclosure({ ...established, contactAskedWhoIsThis: true })
  assert.equal(r.fullIntroRequired, true)
  assert.match(r.reason, /who/i)
})

t('prior disclosure NOT confirmable → FULL intro (fail-safe to more disclosure)', () => {
  const r = evaluateIdentityDisclosure({ ...established, priorDisclosureConfirmable: false })
  assert.equal(r.fullIntroRequired, true)
})

t('no prior disclosure timestamp at all → FULL intro', () => {
  const r = evaluateIdentityDisclosure({ ...established, priorDisclosedAt: null, channelAlreadyTouched: true })
  assert.equal(r.fullIntroRequired, true)
})

console.log('renderIdentityDisclosure — approved, configurable wording')

const config = {
  fsaRoleLabel: 'a Financial Services Agent with Farmers Financial Solutions',
  fullTemplate:
    'This is {{sender.full_name}}, {{fsa_role_label}}. I work with {{agency_owner.full_name}}, your Farmers agent, and I am reaching out on {{agency_owner.first_name}}’s behalf regarding {{communication.reason}}.',
  abbreviatedTemplate: 'This is {{sender.first_name}} (working with {{agency_owner.full_name}}).',
}
const vars = {
  sender: { first_name: 'Markist', full_name: 'Markist Athelus' },
  agency_owner: { first_name: 'Dana', full_name: 'Dana Reed' },
  communication: { reason: 'a life-insurance review' },
}

t('the FULL disclosure fills the approved structure and names the actual sender + represented agent', () => {
  const text = renderIdentityDisclosure(config, vars, 'full')
  assert.match(text, /This is Markist Athelus/)
  assert.match(text, /Financial Services Agent with Farmers Financial Solutions/)
  assert.match(text, /I work with Dana Reed, your Farmers agent/)
  assert.match(text, /on Dana’s behalf/)
  assert.match(text, /regarding a life-insurance review/)
  // Never implies the sender IS the agent / owner.
  assert.doesNotMatch(text, /your agent Markist/i)
})

t('the ABBREVIATED form still names the represented agency owner (never impersonates)', () => {
  const text = renderIdentityDisclosure(config, vars, 'abbreviated')
  assert.match(text, /This is Markist/)
  assert.match(text, /Dana Reed/)
})

t('the Farmers entity label comes from CONFIG (never hard-coded/invented — §4.3)', () => {
  const custom = { ...config, fsaRoleLabel: 'a licensed FSA (label pending verification)' }
  const text = renderIdentityDisclosure(custom, vars, 'full')
  assert.match(text, /label pending verification/)
})

t('prepend helper composes disclosure + body without duplicating when already present', () => {
  const { prependIdentityDisclosure } = require(join(out, 'identity.js'))
  const disclosure = renderIdentityDisclosure(config, vars, 'full')
  const body = 'Would you be open to a brief review?'
  const composed = prependIdentityDisclosure(disclosure, body)
  assert.ok(composed.startsWith(disclosure))
  assert.ok(composed.includes(body))
  // Idempotent: if the body already opens with the disclosure, don't double it.
  assert.equal(prependIdentityDisclosure(disclosure, composed), composed)
})

console.log(`\nAll ${passed} identity-disclosure assertions passed.`)
