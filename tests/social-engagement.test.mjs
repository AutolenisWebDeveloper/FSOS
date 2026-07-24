// Social Content Module — Slice 5 gate (ADR-026): engagement triage + CRM linkage.
//
// Compiles the PURE triage module and asserts classification, routing, and the
// author→contact matching contract — crucially that matching resolves ONLY to an
// existing contact and NEVER fabricates a person record (ADR-001): an unmatched
// author returns null (→ review queue), never a synthesized contact.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-eng-'))
execSync(
  `npx tsc src/lib/social/triage.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const { classifyEngagement, routeFor, matchContact, normalizeEmail, normalizePhone } = require(join(out, 'lib/social/triage.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('classifies leads, questions, complaints, positive, spam, other', () => {
  assert.equal(classifyEngagement('Interested — how much for a policy?'), 'lead')
  assert.equal(classifyEngagement('What time is the workshop?'), 'question')
  assert.equal(classifyEngagement('This is a total scam, I want a refund'), 'complaint')
  assert.equal(classifyEngagement('Thanks, this was really helpful!'), 'positive')
  assert.equal(classifyEngagement('FREE MONEY click here bitcoin giveaway'), 'spam')
  assert.equal(classifyEngagement('nice'), 'other')
  assert.equal(classifyEngagement(''), 'other')
})

t('routes classifications to the right action', () => {
  assert.equal(routeFor('lead'), 'create_lead')
  assert.equal(routeFor('question'), 'reply_needed')
  assert.equal(routeFor('complaint'), 'reply_needed')
  assert.equal(routeFor('spam'), 'ignore')
  assert.equal(routeFor('positive'), 'review')
})

t('normalizes email and phone for matching', () => {
  assert.equal(normalizeEmail('  Jane@Example.COM '), 'jane@example.com')
  assert.equal(normalizeEmail('not-an-email'), null)
  assert.equal(normalizePhone('(469) 555-0100'), '4695550100')
  assert.equal(normalizePhone('123'), null)
})

const candidates = [
  { id: 'c1', email_lc: 'jane@example.com', phone_digits: '4695550100' },
  { id: 'c2', email_lc: 'bob@example.com', phone_digits: '2145550111' },
]

t('matches an author to an EXISTING contact by email', () => {
  const m = matchContact({ email: 'JANE@example.com' }, candidates)
  assert.deepEqual(m, { contactId: 'c1', matchedBy: 'email' })
})

t('matches by phone when email is absent', () => {
  const m = matchContact({ phone: '214-555-0111' }, candidates)
  assert.deepEqual(m, { contactId: 'c2', matchedBy: 'phone' })
})

t('email takes precedence over phone', () => {
  const m = matchContact({ email: 'jane@example.com', phone: '2145550111' }, candidates)
  assert.equal(m.matchedBy, 'email')
  assert.equal(m.contactId, 'c1')
})

t('an unmatched author returns null — NEVER a fabricated contact (ADR-001)', () => {
  assert.equal(matchContact({ email: 'stranger@nowhere.com', phone: '9995550000' }, candidates), null)
  assert.equal(matchContact({}, candidates), null)
  assert.equal(matchContact({ email: 'x@y.com' }, []), null)
})

console.log(`\nSocial Content (Slice 5 — engagement triage): ${passed} assertions passed.`)
