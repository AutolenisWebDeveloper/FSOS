// Frequency caps must count every message the provider ACCEPTED, not only rows whose status is
// still 'sent'. The Twilio/Resend 'delivered' callback moves delivery_status from 'sent' to
// 'delivered'; a count filtered on delivery_status='sent' therefore drops every message that
// worked, and the caps (max SMS/day, 7-day, marketing email, combined, min interval) bound only
// undelivered messages. The ledger fixture below has two DELIVERED SMS today against a cap of 2.
// Audit finding A-03 / E-01 / H-02 (docs/ops/automation-inventory.md).
// Run: node tests/comms-frequency-accepted-sends.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const out = mkdtempSync(join(tmpdir(), 'fsos-freq-accepted-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})
try {
  execSync(
    `npx tsc src/lib/comms/policy-resolver.ts --rootDir src --outDir ${out} --module commonjs ` +
      `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch { /* unresolved '@/…' aliases are expected */ }
const entry = join(out, 'lib/comms/policy-resolver.js')
if (!existsSync(entry)) { console.error('FATAL: policy-resolver.js was not emitted'); process.exit(1) }

const NOW = Date.now()
const ledger = [
  { direction: 'outbound', channel: 'sms', member_id: 'm1', delivery_status: 'delivered', purpose: 'MARKETING', sent_at: new Date(NOW - 60 * 60000).toISOString() },
  { direction: 'outbound', channel: 'sms', member_id: 'm1', delivery_status: 'delivered', purpose: 'MARKETING', sent_at: new Date(NOW - 120 * 60000).toISOString() },
  // Withheld by the gate: never sent, must NOT count.
  { direction: 'outbound', channel: 'sms', member_id: 'm1', delivery_status: 'blocked', purpose: 'MARKETING', sent_at: null },
]
const policyRow = {
  id: 'global', enabled: true, max_sms_per_day: 2, max_sms_per_7_days: 5, max_marketing_emails_per_day: 1,
  max_marketing_emails_per_7_days: 3, max_combined_touches_per_day: 3, min_interval_minutes: 60,
}
const recorded = []

// A tiny in-memory PostgREST imitation for the filters this module uses.
function query(table) {
  const filters = []
  let head = false, order = null, limit = null
  const q = {
    select(_cols, opts) { if (opts?.head) head = true; return q },
    eq(c, v) { filters.push(['eq', c, v]); return q },
    gte(c, v) { filters.push(['gte', c, v]); return q },
    in(c, v) { filters.push(['in', c, v]); return q },
    not(c, op, v) { filters.push(['not', c, op, v]); return q },
    order(c, o) { order = [c, o]; return q },
    limit(n) { limit = n; return q },
    maybeSingle() { return Promise.resolve(run(true)) },
    then(res, rej) { return Promise.resolve(run(false)).then(res, rej) },
  }
  function rows() {
    if (table === 'comm_frequency_policy') return [policyRow].filter((r) => filters.every(([op, c, v]) => op !== 'eq' || r[c] === v))
    return ledger.filter((r) => filters.every((f) => {
      const [op, c, v, w] = f
      if (op === 'eq') return r[c] === v
      if (op === 'gte') return r[c] != null && r[c] >= v
      if (op === 'in') return v.includes(r[c])
      if (op === 'not') return !(v === 'is' && w === null && r[c] == null)
      return true
    }))
  }
  function run(single) {
    if (table === 'comm_messages') recorded.push(filters.slice())
    let r = rows()
    if (order) r = [...r].sort((a, b) => (order[1]?.ascending ? 1 : -1) * String(a[order[0]]).localeCompare(String(b[order[0]])))
    if (limit != null) r = r.slice(0, limit)
    if (head) return { count: r.length, error: null }
    return single ? { data: r[0] ?? null, error: null } : { data: r, error: null }
  }
  return q
}
const db = { from: (t) => query(t) }
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request.endsWith('/supabase/client')) return { __esModule: true, getDb: () => db }
  return origLoad.call(this, request, ...rest)
}
const { resolveFrequency } = require(entry)

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('Frequency caps count provider-accepted sends')

await t('two DELIVERED SMS today hit a max-2/day cap → the third is held', async () => {
  const d = await resolveFrequency('m1', 'sms', 'MARKETING')
  assert.equal(d.allowed, false, `expected a cap hold, got ${JSON.stringify(d)}`)
})
await t('no ledger query filters on delivery_status (a callback must not uncount a send)', async () => {
  for (const f of recorded) assert.ok(!f.some(([op, c]) => op === 'eq' && c === 'delivery_status'), JSON.stringify(f))
})
await t('every ledger query requires sent_at (gate-withheld rows never count)', async () => {
  for (const f of recorded) assert.ok(f.some(([op, c]) => op === 'not' && c === 'sent_at'), JSON.stringify(f))
})
await t('a member with no accepted sends is allowed', async () => {
  const d = await resolveFrequency('m2', 'sms', 'MARKETING')
  assert.equal(d.allowed, true)
})

console.log(`\nAll ${passed} assertions passed.`)
