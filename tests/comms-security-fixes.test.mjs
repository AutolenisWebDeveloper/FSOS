// Regression tests for the comms security hardening surfaced in the platform review:
//   • personalize() HTML-escapes recipient-controlled merge values on the email channel
//     (stored-XSS / HTML-injection defense) but substitutes verbatim for SMS/plaintext.
//   • the click-tracking redirector signs its target and rejects any tampered/foreign URL
//     (open-redirect defense) when a signing secret is configured.
// Both modules are bundled offline with esbuild (installed devDep, no network).
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

process.env.FSOS_TRACKING_SECRET = 'test-secret-abc'

const out = mkdtempSync(join(tmpdir(), 'fsos-sec-'))
const outfile = join(out, 'entry.cjs')
await build({
  stdin: {
    contents: `
      export { personalize } from '../src/lib/comms/personalize'
      export { signRedirect, safeRedirectTarget, instrumentEmailHtml } from '../src/lib/comms/tracking'
    `,
    resolveDir: join(process.cwd(), 'tests'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile,
  logLevel: 'silent',
})
const require = createRequire(pathToFileURL(join(process.cwd(), 'tests/')).href)
const { personalize, signRedirect, safeRedirectTarget } = require(outfile)

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Comms security fixes')

t('personalize() HTML-escapes merge values on the email channel', () => {
  const body = 'Hi {{first_name}}, welcome.'
  const evil = { first_name: '<img src=x onerror=alert(1)>' }
  const escaped = personalize(body, evil, { escapeHtml: true })
  assert.ok(!escaped.includes('<img'), 'raw markup must not survive')
  assert.ok(escaped.includes('&lt;img'), 'markup is HTML-escaped')
})

t('personalize() substitutes verbatim for SMS/plaintext (no escaping)', () => {
  const body = 'Hi {{first_name}}.'
  const out = personalize(body, { first_name: 'A & B' })
  assert.ok(out.includes('A & B'), 'SMS/plaintext keeps the raw value')
})

t('a valid signature round-trips through safeRedirectTarget', () => {
  const id = 'msg-123'
  const url = 'https://example.com/path?a=1'
  const sig = signRedirect(id, url)
  assert.ok(sig.length > 0, 'a secret is configured so a signature is produced')
  assert.equal(safeRedirectTarget(url, { messageId: id, sig }), new URL(url).toString())
})

t('a tampered target / missing / foreign signature is REJECTED (open-redirect defense)', () => {
  const id = 'msg-123'
  const url = 'https://example.com/path'
  const sig = signRedirect(id, url)
  // Attacker swaps the destination but reuses the signature → rejected.
  assert.equal(safeRedirectTarget('https://evil.example/steal', { messageId: id, sig }), null)
  // Signature bound to a different message id → rejected.
  assert.equal(safeRedirectTarget(url, { messageId: 'other-msg', sig: signRedirect('other-msg', 'https://evil.example') }), null)
  // No signature at all → rejected (a secret is configured).
  assert.equal(safeRedirectTarget(url, { messageId: id, sig: null }), null)
})

t('non-http(s) schemes are rejected regardless of signature', () => {
  const id = 'msg-1'
  const js = 'javascript:alert(1)'
  assert.equal(safeRedirectTarget(js, { messageId: id, sig: signRedirect(id, js) }), null)
})

console.log(`\n${passed} comms security assertions passed.`)
