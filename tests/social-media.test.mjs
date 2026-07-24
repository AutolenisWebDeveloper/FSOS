// Social media asset validation (ADR-026, operational depth item 2).
//
// Compiles the PURE media-rules module and asserts: baseline upload validity (mime +
// size), per-platform format/size/dimension/duration rules (a YouTube thumbnail is not
// a Facebook image is not a TikTok video), and that platform compatibility is derived
// from those rules — the same logic that gates the upload API.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-media-'))
execSync(
  `npx tsc src/lib/social/media.ts src/lib/social/adapters/index.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const m = require(join(out, 'lib/social/media.js'))
const { validateAsset, validateAssetForPlatform, platformCompatibility, mediaKindForMime, MAX_IMAGE_BYTES } = m

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// ── Baseline validity ────────────────────────────────────────────────────────
t('a normal PNG passes baseline validation', () => {
  const r = validateAsset({ kind: 'image', mime: 'image/png', byteSize: 500_000, width: 1280, height: 720 })
  assert.equal(r.ok, true)
})

t('an unsupported mime and an oversize file fail baseline validation', () => {
  assert.equal(validateAsset({ kind: 'image', mime: 'image/gif', byteSize: 1000 }).ok, false)
  assert.equal(validateAsset({ kind: 'image', mime: 'image/png', byteSize: MAX_IMAGE_BYTES + 1 }).ok, false)
  assert.equal(validateAsset({ kind: 'image', mime: 'image/png', byteSize: 0 }).ok, false)
})

t('mediaKindForMime classifies image/video and rejects unknown', () => {
  assert.equal(mediaKindForMime('image/jpeg'), 'image')
  assert.equal(mediaKindForMime('video/mp4'), 'video')
  assert.equal(mediaKindForMime('application/pdf'), null)
})

// ── Per-platform rules differ ────────────────────────────────────────────────
t('a large Facebook-sized image is NOT a valid YouTube thumbnail (tighter size)', () => {
  const spec = { kind: 'image', mime: 'image/png', byteSize: 5 * 1024 * 1024, width: 1280, height: 720 }
  assert.equal(validateAssetForPlatform(spec, 'facebook_page').ok, true)
  assert.equal(validateAssetForPlatform(spec, 'youtube').ok, false) // >2MB thumbnail cap
})

t('TikTok takes video but not images; YouTube video accepts MP4', () => {
  assert.equal(validateAssetForPlatform({ kind: 'image', mime: 'image/png', byteSize: 1000, width: 500, height: 500 }, 'tiktok').ok, false)
  assert.equal(validateAssetForPlatform({ kind: 'video', mime: 'video/mp4', byteSize: 1_000_000, durationSeconds: 60 }, 'youtube').ok, true)
})

t('a too-small image fails a platform minimum-dimension rule', () => {
  const tiny = { kind: 'image', mime: 'image/png', byteSize: 1000, width: 100, height: 100 }
  assert.equal(validateAssetForPlatform(tiny, 'youtube').ok, false) // below 640x360
})

t('an over-duration video fails the platform duration cap', () => {
  const long = { kind: 'video', mime: 'video/mp4', byteSize: 1_000_000, durationSeconds: 300 }
  assert.equal(validateAssetForPlatform(long, 'x').ok, false) // X caps ~140s
})

// ── Compatibility is derived from the rules ──────────────────────────────────
t('platformCompatibility lists exactly the platforms whose rule the asset satisfies', () => {
  const thumb = { kind: 'image', mime: 'image/png', byteSize: 1 * 1024 * 1024, width: 1280, height: 720 }
  const compat = platformCompatibility(thumb)
  assert.ok(compat.includes('youtube'))
  assert.ok(compat.includes('facebook_page'))
  assert.ok(!compat.includes('tiktok')) // TikTok takes no image
  // consistency: membership matches the per-platform validator
  for (const p of ['youtube', 'facebook_page', 'instagram', 'linkedin_company', 'x', 'tiktok']) {
    assert.equal(compat.includes(p), validateAssetForPlatform(thumb, p).ok)
  }
})

console.log(`\nSocial Media: ${passed} assertions passed.`)
