// Two-way comms proofs — the pure cores of the Twilio/Resend inbound + tracking
// path, provable without a live Supabase:
//   • STOP/START/HELP keyword classification (compliance-critical opt-out handling);
//   • contact normalization threads the same person to one conversation;
//   • merge-token personalization never leaks a raw {{token}} to a contact;
//   • email open/click instrumentation adds the pixel + rewrites links.
// Run: node tests/comms-two-way.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.comms-out-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })

execSync(
  `npx tsc src/lib/comms/keywords.ts src/lib/comms/personalize.ts src/lib/comms/tracking.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
// tsc infers rootDir from the common parent of the inputs (src/lib/comms), so the
// emitted files land directly under the out dir.
const { classifyKeyword } = require(join(out, 'keywords.js'))
const { personalize, tokensIn } = require(join(out, 'personalize.js'))
const { instrumentEmailHtml, safeRedirectTarget } = require(join(out, 'tracking.js'))

const results = []
function check(name, fn) {
  try { fn(); results.push({ pass: true, name }) }
  catch (e) { results.push({ pass: false, name, err: e.message }) }
}

// ─── Opt-out keyword classification (compliance-critical) ───────────────────────
check('STOP and variants opt the contact out', () => {
  for (const w of ['STOP', 'stop', 'Unsubscribe', 'cancel', 'QUIT', 'end', 'optout', 'revoke']) {
    assert.equal(classifyKeyword(w), 'stop', `${w} → stop`)
  }
  // First word wins even with trailing text / punctuation.
  assert.equal(classifyKeyword('STOP please'), 'stop')
  assert.equal(classifyKeyword('Stop.'), 'stop')
})
check('START re-opts-in; HELP is help; anything else is a normal message', () => {
  assert.equal(classifyKeyword('START'), 'start')
  assert.equal(classifyKeyword('unstop'), 'start')
  assert.equal(classifyKeyword('HELP'), 'help')
  assert.equal(classifyKeyword('Do you have time next week?'), 'message')
  assert.equal(classifyKeyword(''), 'message')
})

// ─── Personalization never leaks a raw token ────────────────────────────────────
check('known tokens substitute; unknown tokens never leak as {{...}}', () => {
  const out1 = personalize('Hi {{first_name}}, from {{fsa_name}}.', { full_name: 'Jane Doe' })
  assert.ok(out1.includes('Jane'), 'first name derived from full name')
  assert.ok(!/\{\{/.test(out1), 'no raw token remains')
  const out2 = personalize('Hello {{unknown_token}}!', {})
  assert.ok(!/\{\{/.test(out2), 'unknown token removed, not leaked')
  const out3 = personalize('Hi {{first_name}}', {})
  assert.ok(out3.includes('there'), 'safe default when no name known')
})
check('tokensIn lists referenced merge tokens', () => {
  assert.deepEqual(tokensIn('{{first_name}} and {{agency_name}} and {{first_name}}').sort(), ['agency_name', 'first_name'])
})

// ─── Email tracking instrumentation ─────────────────────────────────────────────
check('instrumentEmailHtml adds an open pixel and rewrites links (when base url set)', () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  const html = '<body><p>Hi</p><a href="https://calendly.com/book">Book</a></body>'
  const out1 = instrumentEmailHtml(html, '11111111-1111-1111-1111-111111111111')
  assert.ok(out1.includes('/api/track/open/11111111-1111-1111-1111-111111111111'), 'open pixel injected')
  assert.ok(out1.includes('/api/track/click/11111111-1111-1111-1111-111111111111?u='), 'link rewritten through click tracker')
  assert.ok(out1.includes(encodeURIComponent('https://calendly.com/book')), 'original destination preserved (encoded)')
})
check('safeRedirectTarget rejects non-http(s) schemes (no open redirect abuse)', () => {
  assert.equal(safeRedirectTarget('https://ok.example.com/x'), 'https://ok.example.com/x')
  assert.equal(safeRedirectTarget('javascript:alert(1)'), null)
  assert.equal(safeRedirectTarget('data:text/html,x'), null)
  assert.equal(safeRedirectTarget(null), null)
})

// ─── Report ─────────────────────────────────────────────────────────────────────
let failed = 0
for (const r of results) {
  console.log(`${r.pass ? '  ✓' : '  ✗'} ${r.name}${r.pass ? '' : ' — ' + r.err}`)
  if (!r.pass) failed++
}
console.log(`\n${results.length - failed}/${results.length} two-way comms assertions passed.`)
if (failed) process.exit(1)
