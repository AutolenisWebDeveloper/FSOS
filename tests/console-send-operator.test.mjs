// Follow-up R7: a console send of a CAMPAIGN ASSET is automated (US only), consistent with the
// round-3 decision on conversation openers — the body is re-resolved server-side and nothing proves
// the FSA saw the rendered text. A message the FSA typed stays operator-initiated.
// Run: node tests/console-send-operator.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, installDb, makeReq } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fsos-r7-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const stub = (name, src) => { const p = join(dir, name); writeFileSync(p, src); return p }
const auth = stub('auth.mjs', `export async function requireApiRole() { return { ok: true, session: { sub: 'fsa-1' } } }
export function requirePermission() { return null }
export function actorOf() { return 'user:fsa-1' }`)
const send = stub('send.mjs', `export async function sendMessage(ctx) { globalThis.__ctx = ctx; return { sent: true, blocked: false, messageId: 'm1', gate: { allowed: true } } }`)
const assets = stub('assets.mjs', `export async function resolveAssetPayload() { return { channel: 'sms', body: 'Asset body', subject: null, templateId: '11111111-1111-4111-8111-111111111111', campaignKey: 'life', assetId: '22222222-2222-4222-8222-222222222222', sourceTable: 'comm_templates' } }
export async function adHocTemplateId() { return '33333333-3333-4333-8333-333333333333' }`)
const route = await bundle('src/app/api/comms/send/route.ts', { aliases: { '@/lib/auth/api': auth, '@/lib/comms/send': send, '@/lib/comms/assets': assets } })

let passed = 0
const at = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const post = (body) => { installDb(memDb()); globalThis.__ctx = null; return route.POST(makeReq('/api/comms/send', { body: { channel: 'sms', to: '+14165550147', idempotency_key: `k-${Math.random()}`, ...body } })) }

console.log('Console sends: who counts as operator-initiated')
await at('a campaign-asset send is automated (operatorInitiated false)', async () => {
  const res = await post({ source_kind: 'campaign_asset', source_asset_id: '22222222-2222-4222-8222-222222222222', source_asset_table: 'comm_templates' })
  assert.equal(res.status, 200)
  assert.ok(globalThis.__ctx, 'sendMessage was called')
  assert.equal(globalThis.__ctx.operatorInitiated, false)
})
await at('a typed message stays operator-initiated', async () => {
  const res = await post({ body: 'Hi, following up on our call.' })
  assert.equal(res.status, 200)
  assert.equal(globalThis.__ctx.operatorInitiated, true)
})
console.log(`\nAll ${passed} assertions passed.`)
