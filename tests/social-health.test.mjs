// Social platform health aggregation (ADR-026, operational depth item 4).
//
// Compiles the PURE health aggregator and asserts it proactively surfaces the failure
// mode to prevent — a token expiring before it breaks the publish queue — plus recent
// publish failures, rate-limit signal, and an honest overall status derived from the
// item-1 connection-state model (reused, not re-invented).

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-health-'))
execSync(
  `npx tsc src/lib/social/health-agg.ts src/lib/social/onboarding.ts src/lib/social/oauth.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const { computeSocialHealth } = require(join(out, 'lib/social/health-agg.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const NOW = Date.parse('2026-03-01T00:00:00.000Z')
const iso = (days) => new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString()

const healthyChannel = {
  platform: 'youtube',
  status: 'connected',
  hasCredential: true,
  tokenExpiresAt: iso(60),
  lastError: null,
  lastVerifiedAt: iso(-1),
  grantedScopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
}

t('no connected channels → idle overall', () => {
  const r = computeSocialHealth([], [], { pending: 0, failed: 0 }, NOW)
  assert.equal(r.overall, 'idle')
})

t('a healthy connected channel with no failures → healthy', () => {
  const r = computeSocialHealth([healthyChannel], [], { pending: 2, failed: 0 }, NOW)
  assert.equal(r.overall, 'healthy')
  assert.equal(r.platforms[0].connected, true)
  assert.equal(r.tokensExpiringSoon, 0)
})

t('a token expiring within 7 days is flagged PROACTIVELY (degraded, not yet down)', () => {
  const r = computeSocialHealth([{ ...healthyChannel, tokenExpiresAt: iso(3) }], [], { pending: 0, failed: 0 }, NOW)
  assert.equal(r.platforms[0].expiringSoon, true)
  assert.equal(r.platforms[0].expired, false)
  assert.equal(r.tokensExpiringSoon, 1)
  assert.equal(r.overall, 'degraded')
})

t('an expired token → down (the queue-killing failure mode)', () => {
  const r = computeSocialHealth([{ ...healthyChannel, tokenExpiresAt: iso(-1) }], [], { pending: 0, failed: 0 }, NOW)
  assert.equal(r.platforms[0].expired, true)
  assert.equal(r.tokensExpired, 1)
  assert.equal(r.overall, 'down')
})

t('recent publish failures are attributed per platform, with rate-limit signal', () => {
  const failures = [
    { platform: 'youtube', code: 'rate_limited', reason: 'YouTube rate limit.', at: '2026-02-28T10:00:00Z' },
    { platform: 'youtube', code: 'platform_error', reason: 'YouTube error (500).', at: '2026-02-28T11:00:00Z' },
  ]
  const r = computeSocialHealth([healthyChannel], failures, { pending: 0, failed: 2 }, NOW)
  const yt = r.platforms.find((p) => p.platform === 'youtube')
  assert.equal(yt.recentFailures, 2)
  assert.equal(yt.rateLimited, true)
  assert.equal(yt.lastFailure.code, 'platform_error') // most recent
  assert.equal(r.totalRecentFailures, 2)
  assert.equal(r.overall, 'degraded') // failures degrade even with a healthy token
})

t('a platform with an error state reports its WORST channel and drives overall down', () => {
  const errored = { ...healthyChannel, status: 'error', lastError: 'YouTube auth failed (401).' }
  const r = computeSocialHealth([healthyChannel, errored], [], { pending: 0, failed: 0 }, NOW)
  assert.equal(r.platforms[0].tone, 'error')
  assert.equal(r.overall, 'down')
})

console.log(`\nSocial Health: ${passed} assertions passed.`)
