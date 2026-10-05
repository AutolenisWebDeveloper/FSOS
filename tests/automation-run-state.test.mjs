// Follow-up R17: the status UI must not say a run is fine when it is not.
//  a. a run still 'running' past the job lease was hard-killed (serverless timeout) → Timed out.
// Run: node tests/automation-run-state.test.mjs
import assert from 'node:assert/strict'
import { bundle } from './helpers/workshop-harness.mjs'

const st = await bundle('src/lib/ops/automation-status.ts')
const NOW = Date.parse('2026-10-05T18:00:00Z')
const ago = (min) => new Date(NOW - min * 60_000).toISOString()

let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('Run state from execution evidence')

await t('a: running inside the lease → Running', () => {
  assert.equal(st.runState({ status: 'running', started_at: ago(2) }, NOW), 'running')
})
await t('a: running past the job lease → Timed out (not Running)', () => {
  const s = st.runState({ status: 'running', started_at: ago(60) }, NOW)
  assert.equal(s, 'timed_out')
  assert.equal(st.RUN_STATE_LABEL[s], 'Timed out')
  assert.equal(st.RUN_STATE_DOT[s], 'bg-status-lost')
})

if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
