// Native booking — SMS lifecycle template proof (P5 Stage 4). Compiles the pure SMS registry +
// the pure event classifier and asserts the content contract the send path relies on, offline:
//   • the six SMS source keys are EXACTLY the classifier's sms keys (no drift, every event covered);
//   • every body carries STOP inline (dispatcher appends no SMS footer) + sender identity;
//   • only ALREADY-ENFORCED url tokens are used ({{reschedule_url}} / {{scheduling_link}}) — never
//     {{manage_url}} or {{practice_name}} (reconciled away; personalize.ts is not modified);
//   • recap + no-show stay transactional (no product nudge / cross-sell / referral language);
//   • the APPROVED rows migration 135 seeds match this registry byte for byte, body AND
//     render_sha — otherwise `npm run templates:build:sms` would see a hash mismatch on the
//     first run after deploy, reset the freshly-approved rows to DRAFT, and silently switch
//     appointment SMS back off (an SMS leg has no transactional fallback).
// Run: node tests/booking-sms-templates.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-bk-sms-tpl-'))
execSync(
  `npx tsc src/lib/booking/sms-templates.ts src/lib/booking/notify-events.ts src/lib/comms/gsm7.ts ` +
    `src/lib/comms/personalize.ts src/lib/booking/notify-core.ts --rootDir src --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { BOOKING_SMS_TEMPLATES } = require(join(out, 'lib/booking/sms-templates.js'))
const { LIFECYCLE_EVENTS, sourceKeyFor } = require(join(out, 'lib/booking/notify-events.js'))
const { isGsm7Safe, nonGsm7Chars } = require(join(out, 'lib/comms/gsm7.js'))
const { personalize } = require(join(out, 'lib/comms/personalize.js'))
const { buildBookingContext } = require(join(out, 'lib/booking/notify-core.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('SMS registry ↔ classifier')
t('exactly one SMS template per lifecycle event, keyed to the classifier sms source_key', () => {
  assert.equal(BOOKING_SMS_TEMPLATES.length, LIFECYCLE_EVENTS.length)
  const registryKeys = BOOKING_SMS_TEMPLATES.map((t) => t.sourceKey).sort()
  const classifierKeys = LIFECYCLE_EVENTS.map((e) => sourceKeyFor(e, 'sms')).sort()
  assert.deepEqual(registryKeys, classifierKeys)
})
t('every source_key is unique and ends with -sms', () => {
  const keys = BOOKING_SMS_TEMPLATES.map((t) => t.sourceKey)
  assert.equal(new Set(keys).size, keys.length)
  for (const k of keys) assert.match(k, /-sms$/)
})

console.log('A2P / TCPA content contract')
for (const tpl of BOOKING_SMS_TEMPLATES) {
  t(`[${tpl.sourceKey}] carries STOP inline + sender identity, no unenforced tokens`, () => {
    assert.match(tpl.body, /Reply STOP to opt out/i, 'must carry STOP inline (no dispatcher footer)')
    assert.match(tpl.body, /\{\{agency_name\}\}/, 'must lead with the agency identity token')
    // Reconciled away — these would not be enforced absolute/blocking by personalize.ts.
    assert.doesNotMatch(tpl.body, /\{\{manage_url\}\}/, 'must not use the unenforced manage_url token')
    assert.doesNotMatch(tpl.body, /\{\{practice_name\}\}/, 'must not use the non-existent practice_name token')
    // Any URL token present must be one of the enforced, absolute-guaranteed ones.
    const urlTokens = [...tpl.body.matchAll(/\{\{([a-z_]+_url|scheduling_link)\}\}/g)].map((m) => m[1])
    for (const tok of urlTokens) {
      assert.ok(
        tok === 'reschedule_url' || tok === 'scheduling_link',
        `${tpl.sourceKey} uses a non-enforced url token: ${tok}`,
      )
    }
    assert.ok(tpl.body.length <= 480, 'body should stay within a few SMS segments')
  })
}

t('the confirmation (first message) also offers HELP', () => {
  const conf = BOOKING_SMS_TEMPLATES.find((t) => t.sourceKey === 'appointment-confirmation-sms')
  assert.match(conf.body, /HELP for help/i)
})

console.log('recap + no-show stay transactional (no promo)')
for (const key of ['appointment-recap-sms', 'appointment-noshow-sms']) {
  t(`[${key}] carries no product nudge / cross-sell / referral language`, () => {
    const tpl = BOOKING_SMS_TEMPLATES.find((t) => t.sourceKey === key)
    assert.doesNotMatch(tpl.body, /recommend|buy|purchase|quote|invest|policy|cross-?sell|refer(ral)?|discount|offer/i)
  })
}

console.log('encoding + segment budget (measured on the RENDERED body)')
// The authored body is short; what actually ships is the body with a ~180-character signed
// manage link merged in, so segment count has to be measured AFTER rendering. And a single
// non-GSM character (an em dash is the easy mistake, and the reminder shipped with one) drops
// the per-segment budget from 153 characters to 67 — the reminder billed 5 segments instead of 3.
const ABS = 'https://www.markistfsa.com'
const opaque = randomBytes(18).toString('base64url') // generateFormToken()
const payload = Buffer.from(
  JSON.stringify({ t: opaque, p: 'reschedule', exp: Date.now() + 120 * 24 * 3600 * 1000 }),
).toString('base64url')
const signedManage = `${payload}.${createHmac('sha256', 'k'.repeat(32)).update(payload).digest('base64url')}`
const RENDER_CTX = {
  ...buildBookingContext({
    fullName: 'Dana Rivers',
    startsAt: '2026-08-03T14:00:00Z',
    bookerTimezone: 'America/Chicago',
    meetingMode: 'video',
    joinUrl: 'https://zoom.us/j/9',
  }),
  agency_name: 'Markist Athelus Farmers Agency', // BUSINESS.agency
  scheduling_link: `${ABS}/schedule`,
  reschedule_url: `${ABS}/schedule?manage=${encodeURIComponent(signedManage)}`,
}
/** Concatenated-SMS segment count for a rendered body. */
function segments(body) {
  const gsm = isGsm7Safe(body)
  const single = gsm ? 160 : 70
  const perPart = gsm ? 153 : 67
  return body.length <= single ? 1 : Math.ceil(body.length / perPart)
}
const MAX_SEGMENTS = 3

for (const tpl of BOOKING_SMS_TEMPLATES) {
  t(`[${tpl.sourceKey}] stays GSM-7 and within ${MAX_SEGMENTS} segments once rendered`, () => {
    const body = personalize(tpl.body, RENDER_CTX)
    assert.ok(
      isGsm7Safe(body),
      `non-GSM characters force UCS-2 and halve the segment budget: ${JSON.stringify(nonGsm7Chars(body))}`,
    )
    const n = segments(body)
    assert.ok(n <= MAX_SEGMENTS, `${tpl.sourceKey} renders to ${n} segments (${body.length} chars)`)
  })
}

console.log('migration 135 seeds these EXACT bodies as approved')
const MIGRATION = 'supabase/migrations/135_booking_sms_appointment_notices.sql'
const sql = readFileSync(MIGRATION, 'utf8')

for (const tpl of BOOKING_SMS_TEMPLATES) {
  t(`[${tpl.sourceKey}] is seeded with the same body and content hash as the registry`, () => {
    // Postgres string literal: a single quote is doubled.
    const literal = `'${tpl.body.replace(/'/g, "''")}'`
    assert.ok(sql.includes(literal), `${MIGRATION} does not carry this exact body`)
    const sha = createHash('sha256').update(tpl.body, 'utf8').digest('hex')
    assert.ok(sql.includes(sha), `${MIGRATION} does not carry render_sha ${sha} — build-sms-templates.ts would re-draft it`)
    assert.ok(sql.includes(`'${tpl.sourceKey}'`), `${MIGRATION} does not carry source_key ${tpl.sourceKey}`)
  })
}

t('the seed lands as APPROVED (a draft row can never send — SMS has no fallback)', () => {
  assert.match(sql, /approval_status = 'approved'/, 'the adopt branch must approve the row')
  assert.match(sql, /'approved', 1, now\(\)/, 'the insert branch must approve the row')
})

t('it ADOPTS a pre-existing row rather than inserting a duplicate', () => {
  // comm_templates.source_key has no unique constraint, and `templates:build:sms` may already
  // have created draft rows. Two live rows per source_key would break that script's own
  // maybeSingle() lookup and show duplicates in the approval console.
  assert.match(sql, /not exists \(\s*select 1 from comm_templates t where t\.source_key = a\.source_key and t\.archived_at is null\s*\)/i,
    'the insert must be guarded by a live-row check')
  assert.match(sql, /update comm_templates t\s+set name = a\.name/i, 'an existing live row must be adopted in place')
  assert.match(sql, /archived_at = now\(\)/, 'surplus live rows must be soft-archived, never deleted')
  assert.doesNotMatch(sql, /\bdelete\s+from\s+comm_templates\b/i, 'the migration must never hard-delete a template')
})

t('the seed is channel sms + category appointment', () => {
  const smsChannels = sql.match(/'sms', 'appointment'/g) ?? []
  assert.ok(smsChannels.length >= 1, 'the insert branch pins channel + category')
  assert.match(sql, /category = 'appointment'/, 'the adopt branch pins them too')
})

console.log(`\nAll ${passed} assertions passed.`)
