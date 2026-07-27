// Native booking — signed manage-token proof (src/lib/booking/manage-tokens.ts). Compiles the
// crypto module in isolation and asserts the reschedule/cancel link tokens are single-purpose,
// expiring, and unforgeable: a round-trip verifies, expiry/tamper/wrong-key/malformed all fail,
// and the envelope carries the opaque token + purpose (never a database id).
// Run: node tests/booking-manage-token.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-managetok-'))
execSync(
  `npx tsc src/lib/booking/manage-tokens.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { signManageToken, verifyManageToken, manageTokenKey, MANAGE_TOKEN_TTL_MS } = require(join(out, 'manage-tokens.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}
const KEY = 'test-key-abc'
const NOW = 1_800_000_000_000
const OPAQUE = 'r4nd0m-opaque-token-144bit'

t('round-trips: a valid token verifies to its opaque token + purpose', () => {
  const tok = signManageToken(OPAQUE, 'reschedule', NOW + 1000, KEY)
  const v = verifyManageToken(tok, KEY, NOW)
  assert.deepEqual(v, { opaqueToken: OPAQUE, purpose: 'reschedule' })
})
t('is single-purpose: a cancel token carries purpose=cancel', () => {
  const v = verifyManageToken(signManageToken(OPAQUE, 'cancel', NOW + 1000, KEY), KEY, NOW)
  assert.equal(v.purpose, 'cancel')
})
t('carries the opaque token, NOT a database id (no uuid in the payload)', () => {
  const tok = signManageToken(OPAQUE, 'cancel', NOW + 1000, KEY)
  const payload = Buffer.from(tok.split('.')[0], 'base64url').toString('utf8')
  assert.match(payload, /r4nd0m-opaque-token/)
  assert.doesNotMatch(payload, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i) // no uuid
})
t('rejects an expired token', () => {
  const tok = signManageToken(OPAQUE, 'cancel', NOW - 1, KEY)
  assert.equal(verifyManageToken(tok, KEY, NOW), null)
})
t('rejects a token signed with a different key', () => {
  const tok = signManageToken(OPAQUE, 'cancel', NOW + 1000, 'other-key')
  assert.equal(verifyManageToken(tok, KEY, NOW), null)
})
t('rejects a tampered payload (signature no longer matches)', () => {
  const tok = signManageToken(OPAQUE, 'cancel', NOW + 1000, KEY)
  const [, sig] = tok.split('.')
  const forgedPayload = Buffer.from(JSON.stringify({ t: 'evil', p: 'cancel', exp: NOW + 1000 })).toString('base64url')
  assert.equal(verifyManageToken(`${forgedPayload}.${sig}`, KEY, NOW), null)
})
t('rejects a tampered signature', () => {
  const tok = signManageToken(OPAQUE, 'reschedule', NOW + 1000, KEY)
  const [payload] = tok.split('.')
  assert.equal(verifyManageToken(`${payload}.deadbeef`, KEY, NOW), null)
})
t('rejects malformed input (no dot / empty / non-string)', () => {
  assert.equal(verifyManageToken('no-dot', KEY, NOW), null)
  assert.equal(verifyManageToken('', KEY, NOW), null)
  assert.equal(verifyManageToken(undefined, KEY, NOW), null)
})
t('manageTokenKey falls back deterministically for dev', () => {
  assert.equal(typeof manageTokenKey({}), 'string')
  assert.equal(manageTokenKey({ BOOKING_TOKEN_KEY: 'x' }), 'x')
})
t('TTL is a positive duration (120 days)', () => {
  assert.equal(MANAGE_TOKEN_TTL_MS, 120 * 24 * 60 * 60 * 1000)
})

console.log(`\nAll ${passed} assertions passed.`)
