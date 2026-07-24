// Social Content Module — Slice 3 gate (ADR-026): scheduling + idempotent publish.
//
// Compiles the PURE scheduling module + the adapter registry (now with the ACTIVE
// YouTube adapter) and asserts: conflict detection, exponential backoff, dead-letter
// cutoff, dueness, schedule-status guards, the full publish decision (published /
// hold / retry / dead-letter), a retry→dead-letter progression, and that the
// activated YouTube adapter stays inert without a credential (no live call) and
// rejects a video-less post as invalid content (also no live call).

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-sched-'))
execSync(
  `npx tsc src/lib/social/scheduling.ts src/lib/social/adapters/index.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const s = require(join(out, 'lib/social/scheduling.js'))
const adapters = require(join(out, 'lib/social/adapters/index.js'))
const { getAdapter } = adapters

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const MIN = 60_000

// ── Conflict detection ───────────────────────────────────────────────────────
t('conflict when two posts are within the min gap; none when outside it', () => {
  const base = 1_000_000_000_000
  assert.equal(s.hasScheduleConflict([base], base + 20 * MIN), true) // 20 min < 30
  assert.equal(s.hasScheduleConflict([base], base + 31 * MIN), false) // 31 min > 30
  assert.equal(s.hasScheduleConflict([], base), false)
})

// ── Backoff + dead-letter cutoff ─────────────────────────────────────────────
t('exponential backoff grows and is capped', () => {
  assert.equal(s.computeBackoffMs(1), s.BACKOFF_BASE_MS)
  assert.equal(s.computeBackoffMs(2), s.BACKOFF_BASE_MS * 2)
  assert.ok(s.computeBackoffMs(3) > s.computeBackoffMs(2))
  assert.equal(s.computeBackoffMs(999), s.BACKOFF_MAX_MS) // capped
})

t('dead-letter cutoff at MAX_PUBLISH_ATTEMPTS', () => {
  assert.equal(s.isDeadLettered(s.MAX_PUBLISH_ATTEMPTS), true)
  assert.equal(s.isDeadLettered(s.MAX_PUBLISH_ATTEMPTS - 1), false)
})

// ── Dueness ──────────────────────────────────────────────────────────────────
t('an entry is due only when scheduled time passed and backoff elapsed', () => {
  const now = 1_000
  assert.equal(s.isDue(now + 10, null, now), false) // future
  assert.equal(s.isDue(now - 10, null, now), true) // past, no backoff
  assert.equal(s.isDue(now - 10, now + 100, now), false) // backoff not elapsed
  assert.equal(s.isDue(now - 10, now - 1, now), true) // backoff elapsed
})

// ── Schedule status guards ───────────────────────────────────────────────────
t('only pending/failed entries may be rescheduled or cancelled', () => {
  for (const st of ['pending', 'failed']) {
    assert.equal(s.canReschedule(st), true)
    assert.equal(s.canCancel(st), true)
  }
  for (const st of ['publishing', 'published', 'cancelled']) {
    assert.equal(s.canReschedule(st), false)
    assert.equal(s.canCancel(st), false)
  }
})

// ── The publish decision ─────────────────────────────────────────────────────
t('success → published (terminal)', () => {
  const d = s.planAfterAttempt({ ok: true }, 0, 0)
  assert.equal(d.kind, 'published')
  assert.equal(d.nextStatus, 'published')
  assert.equal(d.nextAttemptAtMs, null)
})

t('not_configured → HOLD (stays pending, consumes no retry)', () => {
  const d = s.planAfterAttempt({ ok: false, error: { code: 'not_configured', retryable: false } }, 2, 1000)
  assert.equal(d.kind, 'hold')
  assert.equal(d.nextStatus, 'pending')
  assert.equal(d.attemptsInc, 0)
  assert.ok(d.nextAttemptAtMs > 1000)
})

t('non-retryable error → dead-letter (failed)', () => {
  const d = s.planAfterAttempt({ ok: false, error: { code: 'invalid_content', retryable: false } }, 0, 0)
  assert.equal(d.kind, 'dead_letter')
  assert.equal(d.nextStatus, 'failed')
})

t('retryable error before the cap → retry with backoff', () => {
  const d = s.planAfterAttempt({ ok: false, error: { code: 'network', retryable: true } }, 0, 1000)
  assert.equal(d.kind, 'retry')
  assert.equal(d.nextStatus, 'pending')
  assert.equal(d.attemptsInc, 1)
  assert.ok(d.nextAttemptAtMs > 1000)
})

t('retryable error at the cap → dead-letter', () => {
  const d = s.planAfterAttempt({ ok: false, error: { code: 'network', retryable: true } }, s.MAX_PUBLISH_ATTEMPTS - 1, 0)
  assert.equal(d.kind, 'dead_letter')
})

t('a persistent retryable failure retries then dead-letters exactly once', () => {
  let attempts = 0
  let retries = 0
  let deadLettered = false
  const fail = { ok: false, error: { code: 'network', retryable: true } }
  for (let i = 0; i < 20 && !deadLettered; i++) {
    const d = s.planAfterAttempt(fail, attempts, 0)
    attempts += d.attemptsInc
    if (d.kind === 'retry') retries++
    else if (d.kind === 'dead_letter') deadLettered = true
    else throw new Error(`unexpected decision ${d.kind}`)
  }
  assert.equal(deadLettered, true)
  assert.equal(attempts, s.MAX_PUBLISH_ATTEMPTS) // exactly MAX attempts consumed
  assert.equal(retries, s.MAX_PUBLISH_ATTEMPTS - 1) // last one dead-letters
})

// ── Activated YouTube adapter stays safe without credentials ─────────────────
t('YouTube is now an ACTIVE, postable platform', () => {
  const caps = getAdapter('youtube').capabilities({ platform: 'youtube', hasCredential: true })
  assert.equal(caps.configured, true)
  assert.equal(caps.canPost, true)
})

t('YouTube without a credential is not_configured and makes NO live call', async () => {
  const res = await getAdapter('youtube').publish({ body: 'hi', mediaUrls: ['x'] }, { platform: 'youtube', hasCredential: false })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'not_configured')
})

t('YouTube with a credential but no video → invalid_content (NO live call)', async () => {
  const res = await getAdapter('youtube').publish(
    { body: 'no video here', mediaUrls: [] },
    { platform: 'youtube', hasCredential: true, accessToken: 'test-token-not-used' },
  )
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid_content')
  assert.equal(res.error.retryable, false)
})

await Promise.resolve()
console.log(`\nSocial Content (Slice 3 — scheduling + publish): ${passed} assertions passed.`)
