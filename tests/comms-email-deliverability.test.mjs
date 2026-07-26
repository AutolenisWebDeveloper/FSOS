// Three-life-campaigns launch, Slice 2 (§12, CAN-SPAM) — email deliverability.
// Proves the PURE unsubscribe core (HMAC sign/verify, URL building, RFC 8058
// List-Unsubscribe headers) and the unsubscribe_url personalization token offline.
// No DB, no network. Run: node tests/comms-email-deliverability.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-deliv-'))
execSync(
  `npx tsc src/lib/comms/unsubscribe-core.ts src/lib/comms/personalize.ts ` +
    `--rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const core = require(join(out, 'lib/comms/unsubscribe-core.js'))
const { personalize } = require(join(out, 'lib/comms/personalize.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const BASE = 'https://www.markistfsa.com'
const SECRET = 'test-secret-xyz'
const REPLY = 'mathelus@farmersagent.com'

console.log('unsubscribe-core — HMAC sign/verify (no unauthenticated IDOR, §13.8)')

t('sign is stable and channel/contact-bound', () => {
  const a = core.signUnsubscribe('Jane@Example.com', 'email', SECRET)
  const b = core.signUnsubscribe('jane@example.com', 'email', SECRET) // normalized (lowercased)
  assert.equal(a, b, 'email signing is case-insensitive via normalization')
  assert.ok(a.length > 0)
  assert.notEqual(a, core.signUnsubscribe('jane@example.com', 'sms', SECRET), 'channel is bound')
  assert.notEqual(a, core.signUnsubscribe('other@example.com', 'email', SECRET), 'contact is bound')
})

t('verify accepts a valid token and rejects a tampered one', () => {
  const token = core.signUnsubscribe('jane@example.com', 'email', SECRET)
  assert.equal(core.verifyUnsubscribe('jane@example.com', 'email', token, SECRET), true)
  assert.equal(core.verifyUnsubscribe('jane@example.com', 'email', token + 'x', SECRET), false)
  assert.equal(core.verifyUnsubscribe('jane@example.com', 'email', '', SECRET), false)
  assert.equal(core.verifyUnsubscribe('jane@example.com', 'email', null, SECRET), false)
  assert.equal(core.verifyUnsubscribe('mallory@example.com', 'email', token, SECRET), false, 'token for another contact fails')
})

t('degraded mode (no secret) → sign empty, verify accepts (dev/preview)', () => {
  assert.equal(core.signUnsubscribe('jane@example.com', 'email', null), '')
  assert.equal(core.verifyUnsubscribe('jane@example.com', 'email', 'anything', null), true)
})

console.log('unsubscribe-core — URL building')

t('buildUnsubscribeUrl points at the human page with c + ch', () => {
  const url = core.buildUnsubscribeUrl(BASE, 'jane@example.com', 'email')
  const u = new URL(url)
  assert.equal(u.pathname, '/unsubscribe')
  assert.equal(u.searchParams.get('c'), 'jane@example.com')
  assert.equal(u.searchParams.get('ch'), 'email')
})

t('oneClickUnsubscribeUrl targets the API and carries a token when signed', () => {
  const url = core.oneClickUnsubscribeUrl(BASE, 'jane@example.com', 'email', SECRET)
  const u = new URL(url)
  assert.equal(u.pathname, '/api/comms/unsubscribe')
  assert.equal(u.searchParams.get('c'), 'jane@example.com')
  assert.ok((u.searchParams.get('t') || '').length > 0, 'signed token present')
  // unsigned (no secret) omits the token
  const u2 = new URL(core.oneClickUnsubscribeUrl(BASE, 'jane@example.com', 'email', null))
  assert.equal(u2.searchParams.get('t'), null)
})

console.log('unsubscribe-core — RFC 8058 List-Unsubscribe headers')

t('listUnsubscribeHeaders carries mailto + https + one-click POST', () => {
  const h = core.listUnsubscribeHeaders({ base: BASE, replyEmail: REPLY, contact: 'jane@example.com', secret: SECRET })
  assert.match(h['List-Unsubscribe'], /^<mailto:mathelus@farmersagent\.com\?subject=unsubscribe>, <https:\/\//)
  assert.ok(h['List-Unsubscribe'].includes('/api/comms/unsubscribe'))
  assert.equal(h['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
})

console.log('personalize — unsubscribe_url merge token')

t('resolves {{unsubscribe_url}} from the recipient context', () => {
  const body = 'Manage preferences: {{unsubscribe_url}}'
  const url = 'https://www.markistfsa.com/unsubscribe?c=jane%40example.com&ch=email'
  assert.equal(personalize(body, { unsubscribe_url: url }), `Manage preferences: ${url}`)
})

t('falls back to /unsubscribe when unset (never leaks a raw token)', () => {
  const body = '{{unsubscribe_url}}'
  assert.equal(personalize(body, {}), '/unsubscribe')
})

t('email channel HTML-escapes other merge values but the unsubscribe URL is a plain href', () => {
  // A name with markup is escaped; the unsubscribe URL (system-generated) is not attacker-controlled.
  const out = personalize('Hi {{first_name}} — {{unsubscribe_url}}', { first_name: '<b>x</b>', unsubscribe_url: 'https://x/y?a=1&b=2' }, { escapeHtml: true })
  assert.ok(out.includes('&lt;b&gt;x&lt;/b&gt;'), 'name escaped')
  assert.ok(out.includes('https://x/y?a=1&amp;b=2') || out.includes('https://x/y?a=1&b=2'))
})

console.log('email layout — CAN-SPAM footer regression guard')

t('_layout.tsx carries the unsubscribe token and a physical mailing address', () => {
  const src = readFileSync('src/emails/_layout.tsx', 'utf8')
  assert.ok(src.includes('{{unsubscribe_url}}'), 'unsubscribe merge token present in the shared email footer')
  assert.ok(/CONTACT|address/.test(src), 'physical mailing address wired into the footer')
})

console.log(`\n✅ comms-email-deliverability: ${passed} passed`)
