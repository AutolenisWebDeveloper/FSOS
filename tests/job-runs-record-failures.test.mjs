// runIdempotent must RECORD a failed run, and a failure must stay retryable (audit J-07 / H-15).
// It deleted the claim on a throw, so job_runs — the only cron history the health panels and
// /super/jobs read — could never show a failure: a job that failed every hour looked like one that
// never ran. Now the row is marked 'errored' with the message, and the next attempt for the same
// dedupe key takes it over. Completed rows and live claims still skip; expired leases are reclaimed.
// Run: node tests/job-runs-record-failures.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const out = mkdtempSync(join(tmpdir(), 'fsos-jobruns-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
try {
  execSync(`npx tsc src/lib/jobs/runtime.ts --rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`, { stdio: 'ignore' })
} catch { /* unresolved aliases tolerated */ }
const entry = join(out, 'lib/jobs/runtime.js')
if (!existsSync(entry)) { console.error('FATAL: runtime.js was not emitted'); process.exit(1) }

// In-memory job_runs with the real unique(dedupe_key).
let rows = []
function from() {
  let op = 'select', payload = null
  const f = []
  const b = {
    insert(row) {
      if (rows.some((r) => r.dedupe_key === row.dedupe_key)) return Promise.resolve({ error: { code: '23505', message: 'duplicate' } })
      rows.push({ started_at: new Date().toISOString(), ...row }); return Promise.resolve({ error: null })
    },
    update(p) { op = 'update'; payload = p; return b },
    delete() { op = 'delete'; return b },
    eq(c, v) { f.push((r) => r[c] === v); return b },
    lt(c, v) { f.push((r) => r[c] < v); return b },
    select() { return b },
    then(res, rej) {
      const hit = rows.filter((r) => f.every((fn) => fn(r)))
      if (op === 'update') hit.forEach((r) => Object.assign(r, payload))
      if (op === 'delete') rows = rows.filter((r) => !hit.includes(r))
      return Promise.resolve({ data: hit.map((r) => ({ id: r.dedupe_key })), error: null }).then(res, rej)
    },
  }
  return b
}
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request.endsWith('/supabase/client')) return { __esModule: true, getDb: () => ({ from }) }
  return origLoad.call(this, request, ...rest)
}
const { runIdempotent } = require(entry)

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const row = (k) => rows.find((r) => r.dedupe_key === k)

console.log('job_runs records failures and keeps them retryable')
await t('a successful run is completed', async () => {
  rows = []
  const r = await runIdempotent('a:1', 'a', async () => 42)
  assert.deepEqual(r, { skipped: false, result: 42 })
  assert.equal(row('a:1').status, 'completed')
})
await t('a failed run is RECORDED errored with its message, and the error still propagates', async () => {
  rows = []
  await assert.rejects(runIdempotent('b:1', 'b', async () => { throw new Error('provider timeout') }), /provider timeout/)
  assert.equal(row('b:1').status, 'errored')
  assert.equal(row('b:1').error, 'provider timeout')
  assert.ok(row('b:1').finished_at)
})
await t('the next attempt for the same key takes over the errored run and runs it', async () => {
  let ran = 0
  const r = await runIdempotent('b:1', 'b', async () => { ran++; return 'ok' })
  assert.equal(r.skipped, false)
  assert.equal(ran, 1)
  assert.equal(row('b:1').status, 'completed')
  assert.equal(row('b:1').error, null)
})
await t('a completed key is still an idempotent skip', async () => {
  rows = [{ dedupe_key: 'a:1', job: 'a', status: 'completed', started_at: new Date().toISOString() }]
  let ran = 0
  assert.deepEqual(await runIdempotent('a:1', 'a', async () => { ran++ }), { skipped: true })
  assert.equal(ran, 0)
})
await t('a live running claim is skipped; an expired lease is reclaimed', async () => {
  rows = [{ dedupe_key: 'c:1', job: 'c', status: 'running', started_at: new Date().toISOString() }]
  assert.deepEqual(await runIdempotent('c:1', 'c', async () => 1), { skipped: true })
  rows = [{ dedupe_key: 'c:1', job: 'c', status: 'running', started_at: new Date(Date.now() - 24 * 3600_000).toISOString() }]
  assert.equal((await runIdempotent('c:1', 'c', async () => 1)).skipped, false)
  assert.equal(row('c:1').status, 'completed')
})
console.log(`\nAll ${passed} assertions passed.`)
