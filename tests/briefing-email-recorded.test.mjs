// Follow-up R14: the daily-briefing email route went straight to dispatch(): no message record, and a
// List-Unsubscribe header on the FSA's own inbox. It now goes through sendRecorded like the other
// briefing path (src/app/api/briefing/send/route.ts) — recorded, no tracking, no List-Unsubscribe.
// Run: node tests/briefing-email-recorded.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, installDb, makeReq } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fsos-r14-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const stub = (n, src) => { const p = join(dir, n); writeFileSync(p, src); return p }
const auth = stub('auth.mjs', `export async function requireApiRole() { return { ok: true, session: { userId: 'u1' } } }
export function requirePermission() { return null }
export function actorOf() { return 'user:u1' }`)
const session = stub('session.mjs', `export async function getCurrentUserEmail() { return 'fsa@example.com' }`)
const tx = stub('tx.mjs', `export async function sendRecorded(o) { (globalThis.__recorded ??= []).push(o); return { ok: true, id: 'm1' } }`)
const disp = stub('disp.mjs', `export async function dispatch(r) { (globalThis.__dispatched ??= []).push(r); return { sent: true, gate: { allowed: true } } }`)
const route = await bundle('src/app/api/briefing/email/route.ts', {
  aliases: { '@/lib/auth/api': auth, '@/lib/auth/session': session, '@/lib/notifications/transactional': tx, '@/lib/comms/dispatcher': disp },
})

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('The daily-briefing email is a recorded send')
await t('POST sends through sendRecorded, never dispatch()', async () => {
  installDb(memDb()); globalThis.__recorded = []; globalThis.__dispatched = []
  const res = await route.POST(makeReq('/api/briefing/email', { method: 'POST' }))
  assert.equal(res.status, 200)
  assert.equal(globalThis.__dispatched.length, 0, 'dispatch() was called directly (no record, List-Unsubscribe on the FSA inbox)')
  assert.equal(globalThis.__recorded.length, 1)
  const o = globalThis.__recorded[0]
  assert.equal(o.to, 'fsa@example.com')
  assert.equal(o.consentWaived, true)
  assert.equal(o.entity, undefined, 'no non-uuid entity id is written into comm_messages.entity_id')
})
await t('the route no longer imports the dispatcher', () => {
  assert.doesNotMatch(readFileSync('src/app/api/briefing/email/route.ts', 'utf8'), /from '@\/lib\/comms\/dispatcher'/)
})
console.log(`\nAll ${passed} assertions passed.`)
