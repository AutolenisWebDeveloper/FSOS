// recordMessageEvent must write a status change CONDITIONALLY on the status it reconciled
// against. A read-then-unconditional-write lets two concurrent provider callbacks interleave
// (read 'sent' → 'failed' commits → stale 'delivered' overwrites it). This file drives the real
// function against an in-memory table that commits a competing callback between the read and
// the write, and proves the stale event loses. Audit A-11 / B-07 (docs/ops/automation-inventory.md).
// Run: node tests/comms-status-race.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const out = mkdtempSync(join(tmpdir(), 'fsos-status-race-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})
try {
  execSync(
    `npx tsc src/lib/comms/events.ts --rootDir src --outDir ${out} --module commonjs ` +
      `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch { /* unresolved aliases elsewhere are expected */ }
const entry = join(out, 'lib/comms/events.js')
if (!existsSync(entry)) { console.error('FATAL: events.js was not emitted'); process.exit(1) }

// One comm_messages row. `beforeWrite` lets a test commit a competing callback between this
// call's read and its write.
let row
let beforeWrite = null
let readError = null
function messages() {
  const filters = []
  let mode = 'select'
  let patch = null
  const q = {
    select() { return q },
    update(p) { mode = 'update'; patch = p; return q },
    upsert() { return Promise.resolve({ data: null, error: null }) },
    eq(c, v) { filters.push(['eq', c, v]); return q },
    is(c, v) { filters.push(['is', c, v]); return q },
    maybeSingle() { return Promise.resolve(readError ? { data: null, error: readError } : { data: { ...row }, error: null }) },
    then(res, rej) {
      if (mode !== 'update') return Promise.resolve({ data: [], error: null }).then(res, rej)
      if (beforeWrite) { const f = beforeWrite; beforeWrite = null; f() }
      const match = filters.every(([op, c, v]) => (op === 'is' ? row[c] == null : c === 'id' ? true : row[c] === v))
      if (match) Object.assign(row, patch)
      return Promise.resolve({ data: match ? [{ id: row.id }] : [], error: null }).then(res, rej)
    },
  }
  return q
}
const db = { from: (t) => (t === 'comm_messages' ? messages() : { upsert: () => Promise.resolve({ error: null }) }) }
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request.endsWith('/supabase/client')) return { __esModule: true, getDb: () => db }
  return origLoad.call(this, request, ...rest)
}
const { recordMessageEvent } = require(entry)

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('Concurrent provider callbacks cannot regress a message status')

await t('a failed committed mid-flight beats the stale delivered that read sent', async () => {
  row = { id: 'm1', delivery_status: 'sent' }
  beforeWrite = () => { row.delivery_status = 'failed' }
  await recordMessageEvent({ messageId: 'm1', event: 'delivered' })
  assert.equal(row.delivery_status, 'failed')
})
await t('a lost race re-reads and still applies a genuinely newer outcome', async () => {
  row = { id: 'm2', delivery_status: 'sent' }
  beforeWrite = () => { row.delivery_status = 'delivered' }
  await recordMessageEvent({ messageId: 'm2', event: 'complained' })
  assert.equal(row.delivery_status, 'complained')
})
await t('a duplicate delivered keeps the first delivered_at', async () => {
  row = { id: 'm3', delivery_status: 'delivered', delivered_at: 'FIRST' }
  await recordMessageEvent({ messageId: 'm3', event: 'delivered' })
  assert.equal(row.delivered_at, 'FIRST')
})
await t('a read error writes nothing (never guesses a status)', async () => {
  row = { id: 'm4', delivery_status: 'failed' }
  readError = { message: 'timeout' }
  await recordMessageEvent({ messageId: 'm4', event: 'delivered' })
  readError = null
  assert.equal(row.delivery_status, 'failed')
})
await t('an open still stamps a terminal row without touching its status', async () => {
  row = { id: 'm5', delivery_status: 'delivered' }
  await recordMessageEvent({ messageId: 'm5', event: 'opened' })
  assert.ok(row.opened_at)
  assert.equal(row.delivery_status, 'delivered')
})

console.log(`\nAll ${passed} assertions passed.`)
