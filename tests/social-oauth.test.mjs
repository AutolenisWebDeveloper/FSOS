// Social Content Module — OAuth connect flow gate (ADR-026).
//
// Compiles the PURE OAuth module in isolation (no Next runtime, no DB, no network)
// and asserts the security-critical invariants of the connect flow:
//   • provider config resolves from env and reports NOT configured (with a reason)
//     when the platform credentials are absent — so the UI degrades, never crashes;
//   • only YouTube + Facebook Page are OAuth platforms (others stay inert);
//   • the authorize URL carries client_id / redirect_uri / response_type / scope / state;
//   • signed CSRF state round-trips and REJECTS tamper, wrong key, and expiry;
//   • the encrypted credential envelope parses JSON and legacy plain-token secrets;
//   • refresh-needed detection honors expiry + skew.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-oauth-'))
execSync(
  `npx tsc src/lib/social/oauth.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const oauth = require(join(out, 'lib/social/oauth.js'))
const {
  OAUTH_PLATFORMS,
  isOAuthPlatform,
  providerConfig,
  buildAuthorizeUrl,
  signState,
  verifyState,
  newNonce,
  parseCredential,
  serializeCredential,
  credentialNeedsRefresh,
} = oauth

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// ── OAuth platform set ───────────────────────────────────────────────────────
t('only YouTube + Facebook Page are OAuth platforms', () => {
  assert.deepEqual([...OAUTH_PLATFORMS].sort(), ['facebook_page', 'youtube'])
  assert.equal(isOAuthPlatform('youtube'), true)
  assert.equal(isOAuthPlatform('facebook_page'), true)
  assert.equal(isOAuthPlatform('instagram'), false)
  assert.equal(isOAuthPlatform('nope'), false)
})

// ── Provider config degrades safely when env is absent ───────────────────────
t('providerConfig is NOT configured (with a reason) when env credentials are missing', () => {
  const c = providerConfig('youtube', {})
  assert.equal(c.configured, false)
  assert.ok(c.reason && /not configured/i.test(c.reason), 'must explain how to configure')
  assert.equal(c.clientId, undefined)
})

t('providerConfig is configured when both client id and secret are present', () => {
  const c = providerConfig('facebook_page', {
    SOCIAL_FACEBOOK_APP_ID: 'app-123',
    SOCIAL_FACEBOOK_APP_SECRET: 'secret-abc',
  })
  assert.equal(c.configured, true)
  assert.equal(c.clientId, 'app-123')
  assert.equal(c.reason, undefined)
  assert.ok(Array.isArray(c.scopes) && c.scopes.length > 0)
})

// ── Authorize URL builder ────────────────────────────────────────────────────
t('buildAuthorizeUrl carries the required OAuth parameters', () => {
  const c = providerConfig('youtube', {
    SOCIAL_YOUTUBE_CLIENT_ID: 'cid-9',
    SOCIAL_YOUTUBE_CLIENT_SECRET: 'csecret',
  })
  const url = new URL(
    buildAuthorizeUrl({ config: c, redirectUri: 'https://app.example.com/api/social/oauth/youtube/callback', state: 'STATE1' }),
  )
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(url.searchParams.get('client_id'), 'cid-9')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/api/social/oauth/youtube/callback')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.ok((url.searchParams.get('scope') || '').includes('youtube'))
  assert.equal(url.searchParams.get('state'), 'STATE1')
  // Google offline access so a refresh token is returned.
  assert.equal(url.searchParams.get('access_type'), 'offline')
})

// ── Signed CSRF state ────────────────────────────────────────────────────────
t('signState/verifyState round-trips a valid, unexpired state', () => {
  const key = 'test-key'
  const nonce = newNonce()
  const tok = signState({ platform: 'youtube', nonce, exp: Date.now() + 60_000 }, key)
  const back = verifyState(tok, key, Date.now())
  assert.ok(back)
  assert.equal(back.platform, 'youtube')
  assert.equal(back.nonce, nonce)
})

t('verifyState rejects a tampered payload', () => {
  const key = 'test-key'
  const tok = signState({ platform: 'youtube', nonce: 'n1', exp: Date.now() + 60_000 }, key)
  const [payload, sig] = tok.split('.')
  const forged = Buffer.from(JSON.stringify({ platform: 'facebook_page', nonce: 'n1', exp: Date.now() + 60_000 })).toString('base64url')
  assert.equal(verifyState(`${forged}.${sig}`, key, Date.now()), null)
  // and an unrelated payload with the original signature also fails
  assert.equal(verifyState(`${payload}x.${sig}`, key, Date.now()), null)
})

t('verifyState rejects the wrong signing key and an expired state', () => {
  const tok = signState({ platform: 'youtube', nonce: 'n1', exp: Date.now() + 60_000 }, 'key-a')
  assert.equal(verifyState(tok, 'key-b', Date.now()), null)
  const expired = signState({ platform: 'youtube', nonce: 'n1', exp: Date.now() - 1 }, 'key-a')
  assert.equal(verifyState(expired, 'key-a', Date.now()), null)
})

// ── Credential envelope (encrypted at rest, parsed server-side only) ──────────
t('parseCredential reads a JSON envelope with access + refresh + expiry', () => {
  const raw = serializeCredential({ accessToken: 'AT', refreshToken: 'RT', expiresAt: '2030-01-01T00:00:00.000Z' })
  const env = parseCredential(raw)
  assert.equal(env.accessToken, 'AT')
  assert.equal(env.refreshToken, 'RT')
  assert.equal(env.expiresAt, '2030-01-01T00:00:00.000Z')
})

t('parseCredential treats a legacy plain-string secret as the access token', () => {
  const env = parseCredential('legacy-bearer-token')
  assert.equal(env.accessToken, 'legacy-bearer-token')
  assert.equal(env.refreshToken, undefined)
})

t('parseCredential returns null for empty/absent secrets', () => {
  assert.equal(parseCredential(null), null)
  assert.equal(parseCredential(''), null)
  assert.equal(parseCredential(undefined), null)
})

// ── Refresh decision ─────────────────────────────────────────────────────────
t('credentialNeedsRefresh is true past expiry (minus skew), false when fresh or dateless', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z')
  assert.equal(credentialNeedsRefresh({ accessToken: 'x', expiresAt: '2026-01-01T00:01:00.000Z' }, now), true) // within 2m skew
  assert.equal(credentialNeedsRefresh({ accessToken: 'x', expiresAt: '2026-01-01T01:00:00.000Z' }, now), false)
  assert.equal(credentialNeedsRefresh({ accessToken: 'x' }, now), false)
  assert.equal(credentialNeedsRefresh(null, now), false)
})

console.log(`\nSocial OAuth: ${passed} assertions passed.`)
