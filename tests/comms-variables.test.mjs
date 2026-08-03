// Centralized personalization variable registry (src/lib/comms/variables.ts) + its integration
// with the ONE engine (personalize.ts). Proves: any-casing tokens normalize to one canonical
// key; buildRecipientContext resolves every variable from its authoritative source; factual
// blocking variables fail closed (never a raw token / blank); cosmetic variables degrade.
// Compiled offline with tsc (no DB, no network). Run: node tests/comms-variables.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-vars-'))
execSync(
  `npx tsc src/lib/comms/variables.ts src/lib/comms/personalize.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
// personalize.ts pulls in ../variables → ../../site, so tsc infers rootDir=src/lib → emit under comms/.
const V = require(join(out, 'comms/variables.js'))
const { personalize, unresolvedBlockingTokens, tokensIn } = require(join(out, 'comms/personalize.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('variable registry — one canonical set, one resolver')

t('the registry defines exactly the 25 requested variables, each with a unique canonical key', () => {
  assert.equal(V.VARIABLES.length, 25, '25 canonical variables')
  const keys = V.VARIABLES.map((v) => v.key)
  assert.equal(new Set(keys).size, keys.length, 'canonical keys are unique')
})

t('any casing / separator resolves to ONE canonical key', () => {
  assert.equal(V.canonicalVarKey('FirstName'), 'first_name')
  assert.equal(V.canonicalVarKey('first_name'), 'first_name')
  assert.equal(V.canonicalVarKey('firstName'), 'first_name')
  assert.equal(V.canonicalVarKey('AgentOfRecordFullName'), 'agent_of_record_full_name')
  assert.equal(V.canonicalVarKey('ConversionExpirationDate'), 'conversion_expiration_date')
  // Unregistered tokens keep the legacy lowercase behavior (no accidental remap).
  assert.equal(V.canonicalVarKey('unsubscribe_url'), 'unsubscribe_url')
  assert.equal(V.canonicalVarKey('appointment_time'), 'appointment_time')
})

console.log('buildRecipientContext — authoritative sources')

t('advisor + agency + links + sender resolve from the FSA identity (always available)', () => {
  const ctx = V.buildRecipientContext()
  for (const k of ['advisor_name', 'advisor_title', 'advisor_phone', 'advisor_email', 'agency_name', 'agency_phone', 'agency_address', 'scheduling_link', 'reply_to_email', 'sender_name', 'fsa_name']) {
    assert.ok(ctx[k] && ctx[k].length > 0, `${k} resolved`)
  }
  // {{AdvisorName}} and legacy {{fsa_name}} both render the FSA.
  assert.equal(personalize('{{AdvisorName}} / {{fsa_name}}', ctx), `${ctx.advisor_name} / ${ctx.fsa_name}`)
  assert.equal(ctx.advisor_name, ctx.fsa_name)
})

t('contact name resolves + derives first/last from a full name', () => {
  const ctx = V.buildRecipientContext({ contact: { full_name: 'Dana Q. Rivers' } })
  assert.equal(ctx.full_name, 'Dana Q. Rivers')
  assert.equal(ctx.first_name, 'Dana')
  assert.equal(ctx.last_name, 'Rivers')
  assert.equal(personalize('Hi {{FirstName}}', ctx), 'Hi Dana')
})

t('agent of record resolves name + contact from the agency-owner source', () => {
  const ctx = V.buildRecipientContext({ agentOfRecord: { full_name: 'Jane Smith', phone: '972-555-0100', email: 'jane@example.com' } })
  assert.equal(ctx.agent_of_record_full_name, 'Jane Smith')
  assert.equal(ctx.agent_of_record_first_name, 'Jane')
  assert.equal(ctx.agent_of_record_last_name, 'Smith')
  assert.equal(ctx.agent_of_record_phone, '972-555-0100')
  assert.equal(ctx.agent_of_record_email, 'jane@example.com')
})

t('policy / conversion facts resolve + format from a policy source', () => {
  const ctx = V.buildRecipientContext({
    policy: { policy_number: 'L1234', policy_type: 'term', issue_date: '2020-03-05', face_amount: 500000, conversion_deadline: '2027-01-15' },
    now: '2026-01-15T00:00:00Z',
  })
  assert.equal(ctx.policy_number, 'L1234')
  assert.equal(ctx.policy_issue_date, 'March 5, 2020')
  assert.equal(ctx.policy_face_amount, '$500,000')
  assert.equal(ctx.conversion_expiration_date, 'January 15, 2027')
  assert.equal(ctx.days_until_conversion_expires, '365')
})

console.log('validation — never ship a raw token, a blank, or a guessed factual value')

t('a referenced factual variable with NO source fails closed (blocking)', () => {
  const ctx = V.buildRecipientContext() // no policy source
  const missing = unresolvedBlockingTokens('Your policy {{PolicyNumber}} converts {{ConversionExpirationDate}}.', ctx)
  assert.deepEqual(missing.sort(), ['conversion_expiration_date', 'policy_number'])
})

t('cosmetic variables degrade to a safe neutral (never block, never leak a token)', () => {
  const ctx = V.buildRecipientContext() // no contact
  assert.equal(personalize('Hi {{FirstName}},', ctx), 'Hi there,')
  assert.deepEqual(unresolvedBlockingTokens('Hi {{FirstName}} {{LastName}}', ctx), [])
  assert.ok(!personalize('Hi {{FirstName}}', ctx).includes('{{'), 'no raw token leaks')
})

t('agent-of-record NAME degrades to the generic "your Farmers agent" (never a guessed agent)', () => {
  const ctx = V.buildRecipientContext() // no agent of record
  assert.equal(personalize('I work with {{AgentOfRecordFullName}}.', ctx), 'I work with your Farmers agent.')
  // ...but the agent-of-record CONTACT details fail closed (no safe generic phone/email).
  assert.deepEqual(unresolvedBlockingTokens('Call {{AgentOfRecordPhone}}', ctx), ['agent_of_record_phone'])
})

t('tokensIn returns canonical keys regardless of authoring casing', () => {
  assert.deepEqual(tokensIn('{{FirstName}} {{first_name}} {{AgencyName}}').sort(), ['agency_name', 'first_name'])
})

t('a policy-heavy template FULLY resolves when a policy source is supplied (nothing unresolved)', () => {
  const body =
    'Hi {{FirstName}}, your {{PolicyType}} policy {{PolicyNumber}} (issued {{PolicyIssueDate}}, effective ' +
    '{{PolicyEffectiveDate}}, face {{PolicyFaceAmount}}) has a conversion window closing ' +
    '{{ConversionExpirationDate}} — {{DaysUntilConversionExpires}} days away.'
  const ctx = V.buildRecipientContext({
    contact: { full_name: 'Dana Rivers' },
    policy: { policy_number: 'L1234', policy_type: 'Term Life', issue_date: '2019-06-01', effective_date: '2019-06-15', face_amount: 750000, conversion_deadline: '2027-06-15' },
    now: '2026-06-15T00:00:00Z',
  })
  assert.deepEqual(unresolvedBlockingTokens(body, ctx), [], 'every policy variable resolved')
  const out = personalize(body, ctx)
  assert.ok(!out.includes('{{'), 'no raw token leaked')
  assert.ok(out.includes('Term Life policy L1234') && out.includes('face $750,000') && out.includes('365 days away'))
})

console.log(`\n✓ comms-variables: ${passed} assertions passed`)
