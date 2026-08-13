// District Agent FS Nurture — content integrity + education-boundary lint over the seed migration
// (supabase/migrations/113_district_nurture_seed.sql). Proves the full 12-module curriculum is
// present, well-formed for the email-shell / SMS send path, restricted to resolvable merge tokens,
// on-message for the approved positioning, and free of agent-directed recommendation language.
// The gate's recommendation step is the runtime enforcement; this is the authored-content check.
//
// Run: node tests/district-nurture-content.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const sql = readFileSync('supabase/migrations/113_district_nurture_seed.sql', 'utf8')

// Extract every $body$...$body$ template body.
const bodies = [...sql.matchAll(/\$body\$([\s\S]*?)\$body\$/g)].map((m) => m[1])
const emails = bodies.filter((b) => /^Subject:/m.test(b))
const sms = bodies.filter((b) => !/^Subject:/m.test(b))

// Allowed merge tokens (FSA identity from site.ts + cosmetic first_name). NO agent_of_record_* (the
// recipient IS the Farmers agent) and NO policy tokens.
const ALLOWED_TOKENS = new Set([
  'first_name',
  'fsa_name',
  'advisor_title',
  'advisor_phone',
  'advisor_email',
  'agency_name',
  'scheduling_link',
])

// Agent-directed recommendation language that would breach the education boundary (the agent is not
// licensed for FS). Phrased narrowly so legitimate "the FSA makes any recommendation" copy passes.
const BANNED = [
  /\byou should (buy|purchase|get|choose|invest)\b/i,
  /\bi recommend\b/i,
  /\bwe recommend\b/i,
  /\bbest (product|option|policy) for you\b/i,
  /\byou need to (buy|purchase)\b/i,
]

console.log('\ndistrict-nurture content — curriculum completeness')

t('24 email bodies + 12 SMS bodies are seeded', () => {
  assert.equal(emails.length, 24, `expected 24 emails, found ${emails.length}`)
  assert.equal(sms.length, 12, `expected 12 SMS, found ${sms.length}`)
})

t('every template is seeded as draft (nothing pre-approved)', () => {
  const drafts = [...sql.matchAll(/approval_status/g)] // sanity: column referenced
  assert.ok(drafts.length > 0)
  // No template row may seed as approved.
  assert.equal(/'approved'/.test(sql), false, 'a template is seeded approved — must be draft')
})

t('all 24 email + 12 SMS template ids are referenced by touch rows; live touches have null template', () => {
  const emailIds = [...sql.matchAll(/'(d2e00000-0000-4000-8000-[0-9a-f]{12})'/g)].map((m) => m[1])
  const smsIds = [...sql.matchAll(/'(d3f00000-0000-4000-8000-[0-9a-f]{12})'/g)].map((m) => m[1])
  const uniqEmail = new Set(emailIds)
  const uniqSms = new Set(smsIds)
  assert.equal(uniqEmail.size, 24)
  assert.equal(uniqSms.size, 12)
  // Each id appears at least twice (once in the template insert, once in a touch row).
  for (const id of uniqEmail) assert.ok(emailIds.filter((x) => x === id).length >= 2, `email ${id} not referenced by a touch`)
  for (const id of uniqSms) assert.ok(smsIds.filter((x) => x === id).length >= 2, `sms ${id} not referenced by a touch`)
})

t('40 touch rows: 24 email, 12 sms, 4 advisor_outreach (live touchpoints, null template)', () => {
  const touchBlock = sql.slice(sql.indexOf('into district_nurture_touches'))
  assert.equal((touchBlock.match(/'email',/g) || []).length, 24)
  assert.equal((touchBlock.match(/'sms',/g) || []).length, 12)
  const advisor = (touchBlock.match(/'advisor_outreach', null,/g) || []).length
  assert.equal(advisor, 4, 'expected 4 live touchpoints with a null template')
})

console.log('\ndistrict-nurture content — send-path well-formedness')

t('each email has one Subject:, one Preview:, one CTA, and one closer', () => {
  for (const b of emails) {
    assert.equal((b.match(/^Subject:/gm) || []).length, 1, 'email must have exactly one Subject line')
    assert.equal((b.match(/^Preview:/gm) || []).length, 1, 'email must have exactly one Preview line')
    assert.equal((b.match(/\{\{scheduling_link\}\}/g) || []).length, 1, 'email must carry exactly one scheduling_link CTA')
    const closers = (b.match(/(Warm regards,|Sincerely,)/g) || []).length
    assert.equal(closers, 1, 'email must have exactly one closer')
  }
})

t('SMS carry no opt-out text (dispatcher appends it) and are GSM-7 safe', () => {
  for (const b of sms) {
    assert.equal(/reply stop|opt out|opt-out|unsubscribe/i.test(b), false, `SMS duplicates opt-out text: ${b.slice(0, 40)}`)
    // GSM-7 safety: no smart punctuation that would force UCS-2 and halve segment capacity.
    assert.equal(/[‐-―‘’“”…]/.test(b), false, `SMS has non-GSM punctuation: ${b.slice(0, 40)}`)
    assert.ok(b.trim().length <= 320, `SMS too long (${b.trim().length}): ${b.slice(0, 40)}`)
  }
})

t('every merge token used is a resolvable, allowed token (no agent_of_record_* or policy tokens)', () => {
  for (const b of bodies) {
    for (const m of b.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
      assert.ok(ALLOWED_TOKENS.has(m[1]), `disallowed merge token {{${m[1]}}}`)
    }
  }
})

console.log('\ndistrict-nurture content — positioning + education boundary')

t('the approved positioning statement is present verbatim', () => {
  assert.ok(
    sql.includes('recognize when a deeper conversation is appropriate, and provide the licensed Financial Services support needed to handle it correctly'),
    'the approved positioning line is missing',
  )
})

t('Markist is identified as the FS specialist working alongside the agent, never the P&C agent', () => {
  // Positive: the FSA identity token + the "alongside" framing appear.
  assert.ok(/\{\{fsa_name\}\}/.test(sql))
  assert.ok(/alongside your agency|works alongside/i.test(sql))
  // Negative: no body claims the FSA is the recipient's own P&C agent.
  assert.equal(/i am your (p&c|property) agent/i.test(sql), false)
})

t('no body contains agent-directed recommendation language', () => {
  for (const b of bodies) {
    for (const re of BANNED) {
      assert.equal(re.test(b), false, `banned recommendation phrase ${re} in: ${b.slice(0, 60)}`)
    }
  }
})

t('the securities boundary is stated where it matters (money-in-motion module)', () => {
  // Module 10 must teach "never advise, refer" for investments/rollovers.
  assert.ok(/never advise|do not advise|licensed, registered/i.test(sql))
})

console.log(`\n✓ district-nurture-content: ${passed} assertions passed`)
