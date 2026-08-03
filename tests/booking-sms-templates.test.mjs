// Native booking — SMS lifecycle template proof (P5 Stage 4). Compiles the pure SMS registry +
// the pure event classifier and asserts the content contract the send path relies on, offline:
//   • the six SMS source keys are EXACTLY the classifier's sms keys (no drift, every event covered);
//   • every body carries STOP inline (dispatcher appends no SMS footer) + sender identity;
//   • only ALREADY-ENFORCED url tokens are used ({{reschedule_url}} / {{scheduling_link}}) — never
//     {{manage_url}} or {{practice_name}} (reconciled away; personalize.ts is not modified);
//   • recap + no-show stay transactional (no product nudge / cross-sell / referral language).
// Run: node tests/booking-sms-templates.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-bk-sms-tpl-'))
execSync(
  `npx tsc src/lib/booking/sms-templates.ts src/lib/booking/notify-events.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { BOOKING_SMS_TEMPLATES } = require(join(out, 'sms-templates.js'))
const { LIFECYCLE_EVENTS, sourceKeyFor } = require(join(out, 'notify-events.js'))

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

console.log(`\nAll ${passed} assertions passed.`)
