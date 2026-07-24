// Social Content Module — Slice 6 gate (ADR-026): analytics aggregation.
//
// Compiles the PURE aggregation module and asserts the platform-metric fold:
// followers is a LEVEL (latest-wins), reach/impressions/engagements/clicks are
// FLOWS (summed), missing followers stay null (UI shows "—"), platforms sort by
// label, and an empty input yields an empty result.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-an-'))
execSync(
  `npx tsc src/lib/social/analytics-agg.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const { aggregatePlatformMetrics } = require(join(out, 'lib/social/analytics-agg.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('empty snapshots → empty result', () => {
  assert.deepEqual(aggregatePlatformMetrics([]), [])
})

t('flows sum and followers takes the latest value', () => {
  const rows = [
    { platform: 'youtube', captured_at: '2026-07-01', metrics: { reach: 100, followers: 10, clicks: 5 } },
    { platform: 'youtube', captured_at: '2026-07-02', metrics: { reach: 50, followers: 12, clicks: 3 } },
  ]
  const [yt] = aggregatePlatformMetrics(rows)
  assert.equal(yt.reach, 150) // summed
  assert.equal(yt.clicks, 8) // summed
  assert.equal(yt.followers, 12) // latest, not summed
  assert.equal(yt.capturedAt, '2026-07-02') // latest
})

t('latest-wins holds regardless of input order', () => {
  const rows = [
    { platform: 'youtube', captured_at: '2026-07-02', metrics: { followers: 12 } },
    { platform: 'youtube', captured_at: '2026-07-01', metrics: { followers: 10 } },
  ]
  assert.equal(aggregatePlatformMetrics(rows)[0].followers, 12)
})

t('followers stays null when never reported', () => {
  const rows = [{ platform: 'facebook_page', captured_at: '2026-07-01', metrics: { reach: 20 } }]
  assert.equal(aggregatePlatformMetrics(rows)[0].followers, null)
})

t('accepts alias metric keys (engagement/click_throughs/follower_count)', () => {
  const rows = [{ platform: 'x', captured_at: '2026-07-01', metrics: { engagement: 7, click_throughs: 4, follower_count: 99 } }]
  const [x] = aggregatePlatformMetrics(rows)
  assert.equal(x.engagements, 7)
  assert.equal(x.clicks, 4)
  assert.equal(x.followers, 99)
})

t('multiple platforms are returned sorted by label', () => {
  const rows = [
    { platform: 'youtube', captured_at: '2026-07-01', metrics: {} },
    { platform: 'facebook_page', captured_at: '2026-07-01', metrics: {} },
  ]
  const labels = aggregatePlatformMetrics(rows).map((p) => p.label)
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)))
})

console.log(`\nSocial Content (Slice 6 — analytics): ${passed} assertions passed.`)
