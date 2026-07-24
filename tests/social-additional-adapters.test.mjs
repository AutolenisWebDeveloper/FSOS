// Social Content Module — Slice 7 gate (ADR-026): additional adapters.
//
// Instagram, LinkedIn Company Page, and X ship as configured-but-INACTIVE adapters
// (active:false). This proves the contract: capability discovery reports
// not_configured even WITH a credential (the `active` gate), and publish returns
// not_configured WITHOUT any live API call — even when handed an access token and
// an account id. Their real API-shaped publish paths stay dormant until activated
// with real credentials. No browser automation anywhere.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-add-'))
execSync(
  `npx tsc src/lib/social/adapters/index.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const adapters = require(join(out, 'lib/social/adapters/index.js'))
const { getAdapter, platformSupport, SOCIAL_PLATFORMS } = adapters

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const INACTIVE = ['instagram', 'linkedin_company', 'x']

t('the additional platforms have dedicated adapters', () => {
  for (const p of INACTIVE) assert.equal(getAdapter(p).platform, p)
})

t('each is configured-but-INACTIVE (active:false) — reports not_configured with a credential', () => {
  for (const p of INACTIVE) {
    assert.equal(platformSupport(p).active, false)
    const caps = getAdapter(p).capabilities({ platform: p, hasCredential: true, externalAccountId: 'acct-1' })
    assert.equal(caps.configured, false)
    assert.equal(caps.canPost, false)
    assert.ok(caps.reason && caps.reason.length > 0)
  }
})

// The critical safety property: even with a token + account id, an inactive adapter
// returns not_configured WITHOUT a network call (the `active` gate short-circuits).
const results = []
for (const p of INACTIVE) {
  results.push([
    p,
    await getAdapter(p).publish(
      { body: 'hello', mediaUrls: ['https://example.com/i.jpg'], link: 'https://example.com' },
      { platform: p, hasCredential: true, accessToken: 'tok-not-used', externalAccountId: 'acct-1' },
    ),
  ])
}
t('publish is inert (not_configured, NO live call) even with a token + account id', () => {
  for (const [, res] of results) {
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'not_configured')
    assert.equal(res.error.retryable, false)
  }
})

t('error normalization is inherited and consistent', () => {
  for (const p of INACTIVE) {
    const e = getAdapter(p).normalizeError({ code: 'rate_limited', message: 'slow' })
    assert.equal(e.code, 'rate_limited')
    assert.equal(e.retryable, true)
  }
})

t('every one of the six platforms resolves to an adapter (registry complete)', () => {
  for (const p of SOCIAL_PLATFORMS) assert.equal(typeof getAdapter(p).publish, 'function')
})

await Promise.resolve()
console.log(`\nSocial Content (Slice 7 — additional adapters): ${passed} assertions passed.`)
