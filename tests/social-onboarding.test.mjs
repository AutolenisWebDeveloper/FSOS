// Social account onboarding model (ADR-026, operational depth item 1).
//
// Compiles the PURE onboarding module and asserts the guided-flow invariants:
//   • every requested OAuth scope has a plain-language what/why explanation, keyed to
//     the exact scope strings the provider config asks for (consent can't drift);
//   • the connection-state model resolves EVERY unhappy path (denied/not-connected,
//     partial scopes, expired, revoked, error, expiring) to an honest state with a
//     single clear next action, and only a clean connection is "healthy".

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-onboarding-'))
execSync(
  `npx tsc src/lib/social/onboarding.ts src/lib/social/oauth.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const ob = require(join(out, 'lib/social/onboarding.js'))
const { explainScopes, requiredScopes, grantedCapabilities, missingScopes, connectionStatus } = ob

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// ── Scope explanations ───────────────────────────────────────────────────────
for (const platform of ['youtube', 'facebook_page']) {
  t(`${platform}: every requested scope has a what/why explanation + capability`, () => {
    const req = requiredScopes(platform)
    const ex = explainScopes(platform)
    assert.equal(ex.length, req.length)
    for (const e of ex) {
      assert.ok(req.includes(e.scope), 'explanation keyed to a requested scope')
      assert.ok(e.label && e.label.length > 0)
      assert.ok(e.why && e.why.length > 10, 'why must be a real explanation')
      assert.ok(['publish', 'read_engagement', 'read_analytics'].includes(e.capability))
    }
  })
}

t('publish is among the capabilities the scopes unlock', () => {
  assert.ok(grantedCapabilities('youtube').includes('publish'))
  assert.ok(grantedCapabilities('facebook_page').includes('publish'))
})

// ── Partial-scope detection ──────────────────────────────────────────────────
t('missingScopes is case-insensitive and finds omitted permissions', () => {
  const req = requiredScopes('facebook_page')
  assert.deepEqual(missingScopes(req, req), [])
  const partial = req.slice(0, req.length - 1).map((s) => s.toUpperCase())
  assert.equal(missingScopes(req, partial).length, 1)
  assert.equal(missingScopes(req, []).length, req.length)
})

// ── Connection state model — every unhappy path resolves honestly ────────────
const base = { platform: 'youtube', status: 'connected', hasCredential: true, tokenExpiresAt: null, lastError: null, grantedScopes: requiredScopes('youtube') }
const NOW = Date.parse('2026-02-01T00:00:00.000Z')

t('no credential → not_connected with a Connect action', () => {
  const s = connectionStatus({ ...base, hasCredential: false, status: 'not_configured' }, NOW)
  assert.equal(s.state, 'not_connected')
  assert.equal(s.nextAction.kind, 'connect')
})

t('revoked → error-tone state with a Reconnect action', () => {
  const s = connectionStatus({ ...base, status: 'revoked' }, NOW)
  assert.equal(s.state, 'revoked')
  assert.equal(s.nextAction.kind, 'reconnect')
})

t('last error → error state surfacing the reason, Reconnect action', () => {
  const s = connectionStatus({ ...base, lastError: 'YouTube auth failed (401).' }, NOW)
  assert.equal(s.state, 'error')
  assert.match(s.summary, /401/)
})

t('expired token → expired state, Reconnect', () => {
  const s = connectionStatus({ ...base, tokenExpiresAt: '2026-01-01T00:00:00.000Z' }, NOW)
  assert.equal(s.state, 'expired')
  assert.equal(s.nextAction.kind, 'reconnect')
})

t('partial scopes → partial_scopes warning, Reconnect', () => {
  const s = connectionStatus({ ...base, grantedScopes: [requiredScopes('youtube')[0]] }, NOW)
  assert.equal(s.state, 'partial_scopes')
  assert.equal(s.tone, 'warning')
})

t('expiring soon → expiring warning with days, Reconnect', () => {
  const soon = new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString()
  const s = connectionStatus({ ...base, tokenExpiresAt: soon }, NOW)
  assert.equal(s.state, 'expiring')
  assert.match(s.summary, /day/)
})

t('clean connection → healthy, no next action', () => {
  const far = new Date(NOW + 60 * 24 * 60 * 60 * 1000).toISOString()
  const s = connectionStatus({ ...base, tokenExpiresAt: far }, NOW)
  assert.equal(s.state, 'healthy')
  assert.equal(s.nextAction, null)
})

console.log(`\nSocial Onboarding: ${passed} assertions passed.`)
