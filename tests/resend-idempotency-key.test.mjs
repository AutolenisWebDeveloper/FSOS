// Follow-up R15: the Resend Idempotency-Key was the new message-of-record id, so a retry of the SAME
// logical send after an ambiguous timeout (a new comm_messages row) got a NEW key and could deliver
// twice. Retries of one logical send now reuse one key: the caller's logical idempotencyKey (engine
// enrollment + touch, booking ledger leg, drip step, broadcast enrollment, workforce queue row,
// console idempotency key). Absent → the message id, as before.
// Run: node tests/resend-idempotency-key.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle } from './helpers/workshop-harness.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fsos-r15-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const msg = join(dir, 'messaging.mjs')
writeFileSync(msg, `export async function sendEmail(to, s, b, t, opts) { (globalThis.__emails ??= []).push(opts); return { ok: true, id: 'p1' } }
export async function sendSms() { return { ok: true, id: 'p2' } }`)
const dispatcher = await bundle('src/lib/comms/dispatcher.ts', { aliases: { '../messaging': msg } })

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const req = (correlationId, extra = {}) => ({ channel: 'email', to: 'a@example.com', subject: 's', body: '<p>b</p>', actor: 'x', gate: {}, correlationId, ...extra })
console.log('One logical send, one Resend Idempotency-Key')
await t('two attempts of the same logical send (different message records) carry the same key', async () => {
  globalThis.__emails = []
  await dispatcher.dispatch(req('msg-1', { idempotencyKey: 'life:enr-1:touch-3' }))
  await dispatcher.dispatch(req('msg-2', { idempotencyKey: 'life:enr-1:touch-3' }))
  const [a, b] = globalThis.__emails.map((o) => o.idempotencyKey)
  assert.ok(a, 'a key was sent')
  assert.equal(a, b, 'the retry got a different key')
})
await t('different logical sends never share a key', async () => {
  globalThis.__emails = []
  await dispatcher.dispatch(req('msg-1', { idempotencyKey: 'life:enr-1:touch-3' }))
  await dispatcher.dispatch(req('msg-2', { idempotencyKey: 'life:enr-1:touch-4' }))
  const [a, b] = globalThis.__emails.map((o) => o.idempotencyKey)
  assert.notEqual(a, b)
})
await t('without a logical key the message id is used, as before', async () => {
  globalThis.__emails = []
  await dispatcher.dispatch(req('msg-9'))
  assert.equal(globalThis.__emails[0].idempotencyKey, 'fsos-msg-msg-9')
})
await t('every retrying caller passes a logical key', () => {
  const need = {
    'src/lib/life-campaign/tick.ts': /idempotencyKey: `life:/,
    'src/lib/pipeline-winback/tick.ts': /idempotencyKey: `winback:/,
    'src/lib/cross-sell-life/tick.ts': /idempotencyKey: `xsell:/,
    'src/lib/district-nurture/tick.ts': /idempotencyKey: `district:/,
    'src/lib/booking/notify.ts': /idempotencyKey: `booking:/,
    'src/jobs/handlers.ts': /idempotencyKey: `drip:/,
    'src/lib/comms/campaign.ts': /idempotencyKey: `broadcast:/,
    'src/lib/ai/workforce.ts': /idempotencyKey: `workforce:/,
    'src/app/api/comms/send/route.ts': /idempotencyKey: `console:/,
  }
  for (const [f, re] of Object.entries(need)) assert.match(readFileSync(f, 'utf8'), re, f)
  assert.match(readFileSync('src/lib/comms/send.ts', 'utf8'), /idempotencyKey: ctx\.idempotencyKey/)
})
console.log(`\nAll ${passed} assertions passed.`)
