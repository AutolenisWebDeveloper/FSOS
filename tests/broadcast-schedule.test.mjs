// Follow-up R12f: a broadcast with a FUTURE schedule_at is activated without dispatching; the
// campaign-dispatch cron sends it once schedule_at is reached. Activation used to dispatch at once.
// Run: node tests/broadcast-schedule.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, installDb, makeReq } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fsos-r12f-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const stub = (n, src) => { const p = join(dir, n); writeFileSync(p, src); return p }
const auth = stub('auth.mjs', `export async function requireApiRole() { return { ok: true, session: { userId: 'u1' } } }
export function requirePermission() { return null }
export function actorOf() { return 'user:u1' }`)
const campaign = stub('campaign.mjs', `export async function dispatchCampaign(id) { (globalThis.__dispatched ??= []).push(id); return { audience: 1, sent: 1, suppressed: 0, blocked: 0, deferred: 0 } }`)
const route = await bundle('src/app/api/comms/campaigns/[id]/route.ts', { aliases: { '@/lib/auth/api': auth, '@/lib/comms/campaign': campaign } })

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const activate = (id) => route.POST(makeReq(`/api/comms/campaigns/${id}`, { body: { action: 'activate' } }), { params: Promise.resolve({ id }) })
const seed = (schedule_at) => {
  const db = memDb(); installDb(db)
  db.seed('comm_campaigns', [{ id: 'c1', type: 'broadcast', status: 'draft', simulated_at: new Date().toISOString(), schedule_at }])
  globalThis.__dispatched = []
  return db
}
console.log('A scheduled broadcast waits for its time')
await t('future schedule_at: activation marks it active and does NOT dispatch', async () => {
  const db = seed(new Date(Date.now() + 3 * 86400_000).toISOString())
  const res = await activate('c1')
  assert.equal(res.status, 200)
  assert.equal(globalThis.__dispatched.length, 0, 'dispatched before its schedule')
  assert.equal(db.rows('comm_campaigns')[0].status, 'active')
  assert.ok(db.rows('comm_campaigns')[0].activated_at)
})
await t('no schedule (or a past one): activation dispatches now, as before', async () => {
  seed(null)
  assert.equal((await activate('c1')).status, 200)
  assert.equal(globalThis.__dispatched.length, 1)
})
console.log(`\nAll ${passed} assertions passed.`)
