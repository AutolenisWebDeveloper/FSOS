// Life Conversion Campaign — retry/dead-letter escalation proof (D9 / §20).
// Compiles the PURE retry decision (src/lib/life-campaign/retry.ts) in isolation and asserts the
// backoff schedule and the dead-letter ceiling match the reference Cross-Sell engine, so a stuck
// execution escalates identically across campaigns. The DB wiring (jobs.ts) applies this decision.
// Run: node tests/life-campaign-retry.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-life-retry-'))
execSync(
  `npx tsc src/lib/life-campaign/retry.ts --outDir ${out} --module commonjs ` +
    `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { retryDecision, RETRY_BACKOFF_MINUTES } = require(join(out, 'retry.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('the backoff schedule is 5m → 30m → 2h → 24h', () => {
  assert.deepEqual([...RETRY_BACKOFF_MINUTES], [5, 30, 120, 1440])
})

t('successive attempts walk the backoff table', () => {
  assert.deepEqual(retryDecision(0), { action: 'retry', attempts: 1, backoffMinutes: 5 })
  assert.deepEqual(retryDecision(1), { action: 'retry', attempts: 2, backoffMinutes: 30 })
  assert.deepEqual(retryDecision(2), { action: 'retry', attempts: 3, backoffMinutes: 120 })
  assert.deepEqual(retryDecision(3), { action: 'retry', attempts: 4, backoffMinutes: 1440 })
})

t('the ceiling (default 5 attempts) dead-letters — terminal, no further retry', () => {
  assert.deepEqual(retryDecision(4), { action: 'dead_letter', attempts: 5, backoffMinutes: null })
  // Anything already at/over the ceiling stays dead-lettered.
  assert.equal(retryDecision(9).action, 'dead_letter')
})

t('a custom maxAttempts ceiling is honored', () => {
  assert.equal(retryDecision(0, 1).action, 'dead_letter') // first attempt already hits ceiling 1
  assert.equal(retryDecision(1, 3).action, 'retry')
  assert.equal(retryDecision(2, 3).action, 'dead_letter')
})

console.log(`\nAll ${passed} assertions passed.`)
