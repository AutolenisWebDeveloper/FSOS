// Social Content Module — Slice 1 unit gate (ADR-026).
//
// Compiles the PURE social modules (adapters, status, channel-view, labels) plus
// the reused compliance firewall/guardrail in isolation and asserts the Slice-1
// invariants: adapter capability discovery, inert `not_configured` publishing
// (never a live call), the approval gate, error normalization, the secret-never-
// -serialized property, and securities-firewall enforcement on content.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-'))
execSync(
  `npx tsc ` +
    `src/lib/social/status.ts ` +
    `src/lib/social/channel-view.ts ` +
    `src/lib/social/labels.ts ` +
    `src/lib/social/adapters/index.ts ` +
    `src/lib/compliance/firewall.ts ` +
    `src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const adapters = require(join(out, 'lib/social/adapters/index.js'))
const status = require(join(out, 'lib/social/status.js'))
const view = require(join(out, 'lib/social/channel-view.js'))
const firewall = require(join(out, 'lib/compliance/firewall.js'))
const guardrail = require(join(out, 'lib/compliance/guardrail.js'))

const { getAdapter, capabilitiesFor, SOCIAL_PLATFORMS, platformSupport } = adapters
const { canTransitionContent, isVersionPublishable, assertVersionPublishable } = status
const { toChannelView, CHANNEL_COLUMNS } = view

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// ── Adapter capability discovery ─────────────────────────────────────────────
t('every platform has an adapter', () => {
  for (const p of SOCIAL_PLATFORMS) assert.equal(getAdapter(p).platform, p)
})

t('an inactive adapter reports NOT configured even with a credential present', () => {
  // An inactive platform (instagram is activated later, in Slice 7) is not
  // configured even with a credential (capabilities gate on `active`). NOTE:
  // YouTube is ACTIVE as of Slice 3 — its activation is proven in
  // tests/social-schedule.test.mjs; use a still-inactive platform here.
  const caps = getAdapter('instagram').capabilities({ platform: 'instagram', hasCredential: true })
  assert.equal(caps.configured, false)
  assert.equal(caps.canPost, false)
  assert.ok(caps.reason && caps.reason.length > 0, 'must give a human reason')
})

t('a channel with no credential is not configured, with a "not connected" reason', () => {
  const caps = getAdapter('facebook_page').capabilities({ platform: 'facebook_page', hasCredential: false })
  assert.equal(caps.configured, false)
  assert.match(caps.reason, /not connected|not yet activated/i)
})

t('capabilitiesFor an unknown platform is safely unconfigured (no throw)', () => {
  const caps = capabilitiesFor({ platform: 'myspace', hasCredential: true })
  assert.equal(caps.configured, false)
  assert.equal(caps.canPost, false)
})

t('platformSupport encodes the API reality (TikTok has no engagement API)', () => {
  assert.equal(platformSupport('tiktok').canReadEngagement, false)
  assert.equal(platformSupport('youtube').canPost, true)
})

// ── `not_configured` publishing is inert (never a live call) ─────────────────
// Precompute (top-level await) so the assertions run synchronously inside `t`.
const publishResults = []
for (const p of SOCIAL_PLATFORMS) {
  publishResults.push([p, await getAdapter(p).publish({ body: 'hello' }, { platform: p, hasCredential: true })])
}
t('publish on every inactive adapter returns not_configured and never throws', () => {
  for (const [, res] of publishResults) {
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'not_configured')
    assert.equal(res.error.retryable, false)
  }
})

// ── Error normalization ──────────────────────────────────────────────────────
t('normalizeError maps a rate_limited code to a retryable normalized error', () => {
  const e = getAdapter('youtube').normalizeError({ code: 'rate_limited', message: 'slow down' })
  assert.equal(e.code, 'rate_limited')
  assert.equal(e.retryable, true)
})

t('normalizeError maps an unknown throwable to platform_error, non-retryable', () => {
  const e = getAdapter('youtube').normalizeError(new Error('boom'))
  assert.equal(e.code, 'platform_error')
  assert.equal(e.retryable, false)
  assert.equal(e.message, 'boom')
})

// ── Approval gate (service-layer half) ───────────────────────────────────────
t('only an APPROVED (or PUBLISHED) version is publishable', () => {
  assert.equal(isVersionPublishable('APPROVED'), true)
  assert.equal(isVersionPublishable('PUBLISHED'), true)
  assert.equal(isVersionPublishable('IN_REVIEW'), false)
  assert.equal(isVersionPublishable('SUPERSEDED'), false)
})

t('assertVersionPublishable throws for an unapproved version', () => {
  assert.throws(() => assertVersionPublishable('IN_REVIEW'), /APPROVED/)
  assert.doesNotThrow(() => assertVersionPublishable('APPROVED'))
})

t('content status transitions enforce the lifecycle', () => {
  assert.equal(canTransitionContent('DRAFT', 'IN_REVIEW'), true)
  assert.equal(canTransitionContent('IN_REVIEW', 'APPROVED'), true)
  assert.equal(canTransitionContent('APPROVED', 'SCHEDULED'), true)
  // Cannot skip review to publish, and cannot leave a terminal ARCHIVED state.
  assert.equal(canTransitionContent('DRAFT', 'PUBLISHED'), false)
  assert.equal(canTransitionContent('ARCHIVED', 'DRAFT'), false)
})

// ── Secret is NEVER serialized into a channel view ───────────────────────────
t('CHANNEL_COLUMNS never selects secret_enc; it uses a presence boolean', () => {
  assert.ok(!CHANNEL_COLUMNS.includes('secret_enc,'), 'secret_enc must not be a selected column')
  assert.match(CHANNEL_COLUMNS, /\(secret_enc is not null\) as has_credential/)
})

t('toChannelView exposes has_credential but no token/secret material', () => {
  const v = toChannelView({
    id: 'c1',
    platform: 'youtube',
    external_account_id: 'acc',
    display_name: 'Test',
    status: 'not_configured',
    token_ref: 'vault://k',
    token_expires_at: null,
    scopes: ['a'],
    connected_by: 'u',
    connected_at: null,
    last_verified_at: null,
    last_error: null,
    has_credential: false,
    created_at: 'now',
    updated_at: 'now',
  })
  const keys = Object.keys(v)
  assert.ok(!keys.includes('secret_enc'), 'view must not carry secret_enc')
  assert.ok(!keys.includes('token_ref'), 'view must not carry the token pointer')
  assert.equal(v.has_credential, false)
  assert.equal(v.capabilities.configured, false)
})

// ── Securities firewall enforcement on content (reused, not cloned) ──────────
t('firewall rejects a payload carrying a securities account number', () => {
  assert.throws(
    () => firewall.assertNotSecuritiesSystemOfRecord({ body: 'x', account_number: '123-456' }),
    /firewall|securit/i,
  )
})

t('a clean social content payload passes the firewall', () => {
  assert.doesNotThrow(() =>
    firewall.assertNotSecuritiesSystemOfRecord({ body: 'Educational tips for retirement planning.' }),
  )
})

t('recommendation language in content is detectable (AI red-line, reused)', () => {
  assert.equal(
    typeof guardrail.containsRecommendationLanguage,
    'function',
    'reuse the existing guardrail, do not clone it',
  )
  assert.equal(guardrail.containsRecommendationLanguage('You should buy this annuity now'), true)
})

// node runs the async `t` bodies eagerly; the assertions above throw synchronously
// on failure. A trailing microtask flush keeps the async publish test honest.
await Promise.resolve()
console.log(`\nSocial Content (Slice 1): ${passed} assertions passed.`)
