// Social automation visibility aggregation (ADR-026, operational depth item 5).
//
// Compiles the PURE aggregator and asserts it rolls up the EXISTING agent_runs /
// agent_actions into a per-worker traceability summary: run counts, last run + status,
// error runs, mean confidence, and how many actions the worker flagged for human
// review — all read-only over records the workforce already writes.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-automation-'))
execSync(
  `npx tsc src/lib/social/automation-agg.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const { summarizeWorker, summarizeSocialWorkers, SOCIAL_WORKER_KEYS } = require(join(out, 'lib/social/automation-agg.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const runs = [
  { agent_key: 'content_drafter', status: 'completed', confidence: 0.9, started_at: '2026-03-01T10:00:00Z', error: null },
  { agent_key: 'content_drafter', status: 'completed', confidence: 0.7, started_at: '2026-03-02T10:00:00Z', error: null },
  { agent_key: 'content_drafter', status: 'errored', confidence: 0, started_at: '2026-03-03T10:00:00Z', error: 'gateway error' },
  { agent_key: 'engagement_triager', status: 'completed', confidence: 0.8, started_at: '2026-03-01T09:00:00Z', error: null },
]
const actions = [
  { actor: 'agent:content_drafter', kind: 'draft_content', outcome: 'drafted', created_at: '2026-03-01T10:01:00Z' },
  { actor: 'agent:content_drafter', kind: 'draft_content', outcome: 'drafted_flagged', created_at: '2026-03-02T10:01:00Z' },
  { actor: 'agent:engagement_triager', kind: 'classify', outcome: 'routed', created_at: '2026-03-01T09:01:00Z' },
]

t('per-worker run counts, last run + status, and error runs are correct', () => {
  const cd = summarizeWorker('content_drafter', runs, actions)
  assert.equal(cd.totalRuns, 3)
  assert.equal(cd.lastRunAt, '2026-03-03T10:00:00Z')
  assert.equal(cd.lastStatus, 'errored')
  assert.equal(cd.errorRuns, 1)
})

t('mean confidence averages the runs that reported one', () => {
  const cd = summarizeWorker('content_drafter', runs, actions)
  // (0.9 + 0.7 + 0) / 3
  assert.ok(Math.abs(cd.avgConfidence - 0.5333333) < 1e-3)
})

t('flagged actions are counted separately (what needs extra human review)', () => {
  const cd = summarizeWorker('content_drafter', runs, actions)
  assert.equal(cd.actions, 2)
  assert.equal(cd.flaggedActions, 1)
})

t('a worker only sees ITS OWN runs and actions', () => {
  const et = summarizeWorker('engagement_triager', runs, actions)
  assert.equal(et.totalRuns, 1)
  assert.equal(et.actions, 1)
  assert.equal(et.flaggedActions, 0)
})

t('summarizeSocialWorkers covers exactly the two social workers', () => {
  const s = summarizeSocialWorkers(runs, actions)
  assert.deepEqual(Object.keys(s).sort(), [...SOCIAL_WORKER_KEYS].sort())
  assert.equal(s.content_drafter.totalRuns, 3)
  assert.equal(s.engagement_triager.totalRuns, 1)
})

t('no runs → zeroed worker, not a crash', () => {
  const s = summarizeWorker('content_drafter', [], [])
  assert.equal(s.totalRuns, 0)
  assert.equal(s.avgConfidence, null)
  assert.equal(s.lastRunAt, null)
})

console.log(`\nSocial Automation: ${passed} assertions passed.`)
