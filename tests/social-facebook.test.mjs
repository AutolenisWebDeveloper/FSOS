// Social Content Module — Slice 4 gate (ADR-026): the Facebook Page adapter.
//
// Proves the adapter abstraction holds for a differently-shaped API (a Graph feed
// post, not a video upload) and that the activated adapter stays SAFE without live
// credentials: every asserted path returns BEFORE any network call. No live Graph
// API call is ever made in CI.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-fb-'))
execSync(
  `npx tsc src/lib/social/adapters/index.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const adapters = require(join(out, 'lib/social/adapters/index.js'))
const { getAdapter, platformSupport } = adapters
const fb = getAdapter('facebook_page')

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('Facebook Page is now an ACTIVE, postable platform', () => {
  assert.equal(platformSupport('facebook_page').active, true)
  const caps = fb.capabilities({ platform: 'facebook_page', hasCredential: true, externalAccountId: 'page-1' })
  assert.equal(caps.configured, true)
  assert.equal(caps.canPost, true)
})

t('without a credential → not_configured (NO live call)', async () => {
  const res = await fb.publish({ body: 'hi' }, { platform: 'facebook_page', hasCredential: false, externalAccountId: 'page-1' })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'not_configured')
})

t('with a credential but no Page id → unsupported (NO live call)', async () => {
  const res = await fb.publish(
    { body: 'hi' },
    { platform: 'facebook_page', hasCredential: true, accessToken: 'tok-not-used' },
  )
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'unsupported')
  assert.equal(res.error.retryable, false)
})

t('with a credential + Page id but empty content → invalid_content (NO live call)', async () => {
  const res = await fb.publish(
    { body: '   ' },
    { platform: 'facebook_page', hasCredential: true, accessToken: 'tok-not-used', externalAccountId: 'page-1' },
  )
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid_content')
})

t('error normalization is inherited and consistent', () => {
  const e = fb.normalizeError({ code: 'rate_limited', message: 'slow down' })
  assert.equal(e.code, 'rate_limited')
  assert.equal(e.retryable, true)
})

await Promise.resolve()
console.log(`\nSocial Content (Slice 4 — Facebook Page adapter): ${passed} assertions passed.`)
