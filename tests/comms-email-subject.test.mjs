// tests/comms-email-subject.test.mjs
// REGRESSION PROOF: every campaign email leaves FSOS with a real envelope subject.
//
// comm_templates has no `subject` column. An email body carries its subject on a leading
// "Subject:" line, which email-shell.ts strips and renders as the card H1 and which
// template-subject.ts extracts for the send envelope. Two paths never did that extraction, so
// the recipient saw a correctly-headed email whose inbox row read "(No Subject)":
//
//   • assets.ts resolveAssetPayload() returned `subject: null` for every comm_template-backed
//     asset, which is what the Communications Command Console's individual/AI/test sends use.
//   • sendThroughGate() passed the caller's ctx.subject straight through, so ANY caller that
//     did not parse the header — the console, the test-send route, an agent seed — shipped an
//     empty subject even though the body had one.
//
// What this proves:
//   1. parseSubjectFromBody — the real compiled helper — on the header shapes that occur.
//   2. Every email template in the live campaign copy (migrations 106/107/108) yields a
//      non-empty subject through that helper. A body that loses its header can never ship.
//   3. sendThroughGate resolves the subject ONCE and uses that resolved value for the stored
//      row, the rendered preheader, and the dispatch envelope — never the raw ctx.subject.
//   4. resolveAssetPayload derives an email asset's subject from its body.
//
// (3) and (4) are source-level assertions: both functions are DB-bound, and the defect was
// precisely a missing derivation at a known choke point, which is exactly what a structural
// check pins. Pure file parsing + one tsc compile — no DB, no network.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-subject-'))
execSync(
  `npx tsc src/lib/comms/template-subject.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { parseSubjectFromBody } = require(join(out, 'template-subject.js'))

let failures = 0
function t(name, fn) {
  try { fn(); console.log(`  ok  ${name}`) }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${e.message}`) }
}

console.log('parseSubjectFromBody')

t('extracts the subject from the leading header line', () => {
  assert.equal(parseSubjectFromBody('Subject: Picking this back up?\nPreview: x\n\nHi,'), 'Picking this back up?')
})

t('is case- and whitespace-tolerant', () => {
  assert.equal(parseSubjectFromBody('subject:   Trimmed  \nrest'), 'Trimmed')
})

t('returns undefined when the body has no header (never a blank string)', () => {
  assert.equal(parseSubjectFromBody('Hi there,\n\nNo header here.'), undefined)
  assert.equal(parseSubjectFromBody(''), undefined)
  assert.equal(parseSubjectFromBody(null), undefined)
})

t('only the FIRST line counts, matching email-shell.ts header parsing', () => {
  assert.equal(parseSubjectFromBody('Hi there,\nSubject: too late'), undefined)
})

console.log('\nlive campaign email copy')

// Email template-id prefixes per campaign (the SMS/AI assets carry no subject by design).
const CAMPAIGNS = [
  ['Win-Back', 'supabase/migrations/106_pipeline_winback_messaging_v3.sql', 'a2b00000'],
  ['Cross-Sell Life', 'supabase/migrations/107_cross_sell_life_messaging_v3.sql', 'e5c00000'],
  ['Life Conversion', 'supabase/migrations/108_life_conversion_messaging_v3.sql', 'e1c00000'],
]

for (const [key, file, emailPrefix] of CAMPAIGNS) {
  const sql = readFileSync(file, 'utf8')
  const re = /body\s*=\s*\$body\$([\s\S]*?)\$body\$[\s\S]*?where id = '([0-9a-f-]{36})';/g
  const emails = []
  let m
  while ((m = re.exec(sql)) !== null) {
    if (m[2].startsWith(emailPrefix)) emails.push({ body: m[1], id: m[2] })
  }

  t(`${key}: every email body yields a non-empty subject through the real parser`, () => {
    assert.ok(emails.length > 0, `${key} exposed no email templates`)
    for (const e of emails) {
      const subject = parseSubjectFromBody(e.body)
      assert.ok(subject && subject.trim(), `${e.id} would be delivered as "(No Subject)"`)
      // Mail clients truncate well before this; a runaway H1 is a copy defect, not a subject.
      assert.ok(subject.length <= 120, `${e.id} subject is ${subject.length} chars`)
    }
  })
}

console.log('\nsend-path wiring')

const send = readFileSync('src/lib/comms/send.ts', 'utf8')
const assets = readFileSync('src/lib/comms/assets.ts', 'utf8')

t('sendThroughGate resolves the subject from the body when the caller supplies none', () => {
  assert.match(
    send,
    /const resolvedSubject\s*=[\s\S]{0,200}parseSubjectFromBody\(ctx\.body\)/,
    'send.ts no longer derives a fallback subject from the body',
  )
})

t('the stored row, the preheader and the dispatch envelope all use the RESOLVED subject', () => {
  assert.match(send, /subject: resolvedSubject \?\? null/, 'comm_messages row does not store the resolved subject')
  assert.match(send, /preheader: resolvedSubject/, 'the email shell preheader does not use the resolved subject')
  assert.match(send, /subject: resolvedSubject,/, 'the dispatch envelope does not use the resolved subject')
  // The whole point: once resolved, nothing downstream may fall back to the raw ctx.subject.
  const declaration = send.indexOf('const resolvedSubject')
  assert.ok(declaration > 0, 'resolvedSubject declaration not found')
  const afterDeclaration = send.slice(send.indexOf('\n', send.indexOf('\n', declaration) + 1))
  assert.doesNotMatch(
    afterDeclaration, /ctx\.subject/,
    'a send path still reads ctx.subject after resolution — it must only feed resolvedSubject',
  )
})

t('resolveAssetPayload derives an email asset subject from its template body', () => {
  assert.match(
    assets,
    /subject: channel === 'email' \? parseSubjectFromBody\(t\.body\) \?\? null : null/,
    'assets.ts still returns a null subject for comm_template-backed email assets',
  )
})

console.log('')
if (failures > 0) {
  console.error(`${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('email subject resolution: all checks passed')
