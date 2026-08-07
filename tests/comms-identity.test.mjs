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
  // Idempotent: if the body already carries the disclosure, don't double it.
  assert.equal(prependIdentityDisclosure(disclosure, composed), composed)
})

// The disclosure is the first PARAGRAPH, which on a campaign email is not the first LINE: the
// body opens with the "Subject:"/"Preview:" routing headers that email-shell.ts parses into the
// card H1 and the inbox preheader. Prepending ahead of them stripped the email of its subject
// heading and rendered a literal "Subject: …" line as body copy.
t('inserts AFTER the Subject:/Preview: headers so the email keeps its heading', () => {
  const { prependIdentityDisclosure } = require(join(out, 'identity.js'))
  const disclosure = renderIdentityDisclosure(config, vars, 'full')
  const body = [
    'Subject: Picking this back up?',
    'Preview: No pressure at all.',
    '',
    'Hi Jonathan,',
    '',
    'A while back you started looking into life insurance with us.',
  ].join('\n')
  const composed = prependIdentityDisclosure(disclosure, body)
  const lines = composed.split('\n')
  assert.match(lines[0], /^Subject: Picking this back up\?$/)
  assert.match(lines[1], /^Preview: No pressure at all\.$/)
  // Greeting stays attached to the top; the disclosure opens the body proper.
  assert.ok(composed.indexOf('Hi Jonathan,') < composed.indexOf(disclosure))
  assert.ok(composed.indexOf(disclosure) < composed.indexOf('A while back'))
  assert.equal(prependIdentityDisclosure(disclosure, composed), composed)
})

t('still leads an SMS body, which has no headers or standalone greeting', () => {
  const { prependIdentityDisclosure } = require(join(out, 'identity.js'))
  const disclosure = renderIdentityDisclosure(config, vars, 'full')
  const body = 'Hi Jonathan, is life insurance still on your list?'
  assert.ok(prependIdentityDisclosure(disclosure, body).startsWith(disclosure))
})

// ── Inactivity is measured from the last CONTACT, not the age of the disclosure ──
// Ageing off the disclosure re-introduced the FSA mid-campaign purely because the campaign had
// been running longer than the window — the opposite of the rule's intent.
console.log('evaluateIdentityDisclosure — inactivity window')

t('an actively-messaged thread does NOT re-introduce, however old the disclosure is', () => {
  const d = evaluateIdentityDisclosure({
    ...established,
    priorDisclosedAt: '2026-01-10T12:00:00Z', // 6 months ago
    lastContactAt: '2026-07-20T12:00:00Z', // but messaged 3 days ago
    now: '2026-07-23T12:00:00Z',
    inactivityDays: 45,
  })
  assert.equal(d.fullIntroRequired, false)
})

t('a thread that has genuinely gone quiet DOES re-introduce', () => {
  const d = evaluateIdentityDisclosure({
    ...established,
    priorDisclosedAt: '2026-01-10T12:00:00Z',
    lastContactAt: '2026-02-01T12:00:00Z',
    now: '2026-07-23T12:00:00Z',
    inactivityDays: 45,
  })
  assert.equal(d.fullIntroRequired, true)
  assert.match(d.reason, /inactive/i)
})

t('falls back to the disclosure date when the thread has no recorded traffic', () => {
  const d = evaluateIdentityDisclosure({
    ...established,
    priorDisclosedAt: '2026-01-10T12:00:00Z',
    lastContactAt: null,
    now: '2026-07-23T12:00:00Z',
    inactivityDays: 45,
  })
  assert.equal(d.fullIntroRequired, true)
})

// ── Agent of record: the {{agency_owner.reference}} token names the client's OWN agent when
// known and degrades to the generic "your Farmers agent" when not (ADR-016, §4.3). Uses the
// FSA's APPROVED production wording (migration 094_identity_disclosure_agent_of_record).
console.log('renderIdentityDisclosure — agent-of-record reference (approved wording)')

const prodConfig = {
  fsaRoleLabel: 'a Financial Services Agent with Farmers Financial Solutions',
  fullTemplate:
    'This is {{sender.full_name}} with Farmers Financial Solutions. I work with {{agency_owner.reference}}, and assist the agency’s clients with life insurance and financial services.',
  abbreviatedTemplate: 'This is {{sender.first_name}} with Farmers Financial Solutions, working with {{agency_owner.reference}}.',
}

t('names the client’s ACTUAL agent of record when it is resolved', () => {
  const text = renderIdentityDisclosure(
    prodConfig,
    { sender: { full_name: 'Markist Athelus' }, agency_owner: { full_name: 'Dana Reed' } },
    'full',
  )
  assert.match(text, /This is Markist Athelus with Farmers Financial Solutions\./)
  assert.match(text, /I work with your Farmers agent, Dana Reed, and assist/)
  // Never a doubled generic, never an empty/broken clause.
  assert.doesNotMatch(text, /your Farmers agent, your Farmers agent/)
  assert.doesNotMatch(text, /\{\{/)
})

t('degrades to the generic "your Farmers agent" (never a guessed name) when unresolved', () => {
  const text = renderIdentityDisclosure(
    prodConfig,
    { sender: { full_name: 'Markist Athelus' }, agency_owner: {} },
    'full',
  )
  // Reads correctly with NO name — not "your Farmers agent, your Farmers agent", not ", ,".
  assert.match(text, /I work with your Farmers agent, and assist/)
  assert.doesNotMatch(text, /your Farmers agent, your Farmers agent/)
  assert.doesNotMatch(text, /,\s*,/)
})

t('the sender is the FSA, the agent of record is the represented party (no impersonation)', () => {
  const text = renderIdentityDisclosure(
    prodConfig,
    { sender: { full_name: 'Markist Athelus' }, agency_owner: { full_name: 'Dana Reed' } },
    'full',
  )
  // "This is Markist" (sender) — never "This is Dana" (the agent of record is not the sender).
  assert.match(text, /^This is Markist Athelus/)
  assert.doesNotMatch(text, /This is Dana Reed/)
})

console.log(`\nAll ${passed} identity-disclosure assertions passed.`)
