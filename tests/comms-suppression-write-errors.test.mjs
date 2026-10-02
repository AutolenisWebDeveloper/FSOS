// An opt-out that did not land must never be reported — or acknowledged — as applied.
//   • supabase-js resolves { error } instead of throwing, so the suppression writers reported
//     success with nothing written (audit B-14). recordChannelOptOut / suppressContact /
//     applyDeliverabilitySuppression now return failure on an ENFORCED write error.
//   • An inbound STOP ran AFTER the idempotency short-circuit and AFTER threading: a threading
//     failure lost it, and a provider retry of a half-processed STOP was skipped as a duplicate
//     (audit B-13). It now runs first, keyed on the sender address.
//   • Every webhook that writes a suppression answers 5xx when it failed, so it is redelivered.
// Run: node tests/comms-suppression-write-errors.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const out = mkdtempSync(join(tmpdir(), 'fsos-supp-errors-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
try {
  execSync(
    `npx tsc src/lib/comms/inbound.ts src/lib/comms/conversations.ts src/lib/comms/keywords.ts src/lib/comms/opt-out.ts ` +
      `src/lib/comms/deliverability.ts src/lib/comms/unsubscribe.ts src/lib/booking/optout-appointment-review.ts src/lib/site.ts ` +
      `--rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch { /* expected: unresolved '@/…' aliases */ }
for (const f of ['comms/inbound.js', 'comms/opt-out.js', 'comms/deliverability.js']) {
  if (!existsSync(join(out, 'lib', f))) { console.error(`FATAL: ${f} was not emitted`); process.exit(1) }
}

// ── In-memory database with failure injection ────────────────────────────────
const PHONE = '+15125551234'
let state
function reset(over = {}) {
  state = { writes: [], failWrites: new Set(), existingMessage: false, conversationFails: false, ...over }
}
const ERR = { message: 'simulated write failure' }
function from(table) {
  let op = 'select'
  let payload = null
  const filters = {}
  const writeResult = () => (state.failWrites.has(table) ? { data: null, error: ERR } : { data: null, error: null })
  const b = {
    select: () => b, eq: (c, v) => { filters[c] = v; return b }, in: () => b, gt: () => b, ilike: () => b,
    is: () => b, or: () => b, order: () => b, limit: () => b, not: () => b,
    insert: (row) => { op = 'insert'; payload = row; state.writes.push({ table, op, row }); return b },
    update: (row) => { op = 'update'; payload = row; state.writes.push({ table, op, row }); return b },
    upsert: (row) => { op = 'upsert'; payload = row; state.writes.push({ table, op, row }); return b },
    async maybeSingle() {
      if (op === 'insert') {
        if (table === 'comm_conversations' && state.conversationFails) return { data: null, error: ERR }
        return { data: { id: `${table}-1`, ...payload }, error: null }
      }
      if (table === 'comm_messages' && filters.provider_id && state.existingMessage) {
        return { data: { id: 'msg-already', conversation_id: 'conv-already' }, error: null }
      }
      if (table === 'comm_conversations' && state.conversationFails) return { data: null, error: ERR }
      return { data: null, error: null }
    },
    then: (res, rej) => Promise.resolve(op === 'select' ? { data: [], error: null } : writeResult()).then(res, rej),
  }
  return b
}
const db = { from }
const makeStub = () => new Proxy(function () {}, {
  get: (_t, p) => (p === '__esModule' ? true : p === 'then' ? undefined : makeStub()),
  apply: () => makeStub(),
})
const RELATIVE_STUBS = new Set(['./send', './events', './turn-limit', './suppression-admin', './consent-events'])
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === '@/lib/supabase/client' || request.endsWith('/supabase/client')) return { __esModule: true, getDb: () => db }
  if (request === '@/lib/audit/log' || request.endsWith('/audit/log')) return { __esModule: true, writeAudit: async () => ({ ok: true }) }
  if (request === '@/lib/ai/responder') return { __esModule: true, draftReply: async () => null }
  if (RELATIVE_STUBS.has(request)) return makeStub()
  if (request.startsWith('@/')) {
    const emitted = join(out, request.slice(2) + '.js')
    if (existsSync(emitted)) return origLoad.call(this, emitted, ...rest)
    return makeStub()
  }
  return origLoad.call(this, request, ...rest)
}
const { processInbound } = require(join(out, 'lib/comms/inbound.js'))
const { recordChannelOptOut } = require(join(out, 'lib/comms/opt-out.js'))
const { suppressContact } = require(join(out, 'lib/comms/unsubscribe.js'))
const { applyDeliverabilitySuppression } = require(join(out, 'lib/comms/deliverability.js'))

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const dncUpserts = () => state.writes.filter((w) => w.table === 'dnc_entries' && w.op === 'upsert')
const OPT = { contact: PHONE, channel: 'sms', source: 'test', reason: 'inbound STOP (test)', consentText: 'x', memberId: 'm1', householdId: 'h1' }

console.log('The enforced opt-out writers report a returned error')
for (const table of ['dnc_entries', 'comm_contact_consents', 'consents', 'comm_consent_purposes']) {
  await t(`recordChannelOptOut → ok:false when ${table} returns an error`, async () => {
    reset({ failWrites: new Set([table]) })
    assert.deepEqual(await recordChannelOptOut(OPT), { ok: false })
  })
}
await t('recordChannelOptOut → ok:true on clean writes', async () => {
  reset()
  assert.deepEqual(await recordChannelOptOut(OPT), { ok: true })
})
await t('suppressContact → ok:false when the DNC upsert returns an error', async () => {
  reset({ failWrites: new Set(['dnc_entries']) })
  assert.equal((await suppressContact('a@example.com', 'email', {})).ok, false)
})
await t('a hard bounce whose suppression did not land is flagged failed (webhook → 5xx)', async () => {
  reset({ failWrites: new Set(['dnc_entries']) })
  const r = await applyDeliverabilitySuppression({ event: 'complained', email: 'a@example.com' })
  assert.equal(r.suppressed, false)
  assert.equal(r.failed, true)
})
await t('a clean complaint suppression is not flagged failed', async () => {
  reset()
  const r = await applyDeliverabilitySuppression({ event: 'complained', email: 'a@example.com' })
  assert.equal(r.suppressed, true)
  assert.equal(r.failed, undefined)
})

console.log('\nInbound STOP is applied first, keyed on the sender address')
await t('threading fails → the STOP is still written', async () => {
  reset({ conversationFails: true })
  const r = await processInbound({ channel: 'sms', from: PHONE, body: 'STOP', provider: 'twilio', providerId: 'SM1' })
  assert.equal(r.conversationId, null, 'precondition: no conversation was created')
  assert.equal(dncUpserts().length, 1)
  assert.equal(r.optedOut, true)
})
await t('a redelivered STOP already recorded as a message is still (re)applied', async () => {
  reset({ existingMessage: true })
  const r = await processInbound({ channel: 'sms', from: PHONE, body: 'STOP', provider: 'twilio', providerId: 'SM1' })
  assert.equal(r.messageId, 'msg-already', 'precondition: the idempotency short-circuit fired')
  assert.equal(dncUpserts().length, 1)
})
await t("the DNC reason keeps the 'inbound STOP' prefix a bare START needs (decision 4)", async () => {
  reset()
  await processInbound({ channel: 'sms', from: PHONE, body: 'STOP', provider: 'twilio', providerId: 'SM2' })
  assert.match(dncUpserts()[0].row.reason, /^inbound STOP/)
})
await t('a failed STOP write → optOutFailed, never reported as opted out', async () => {
  reset({ failWrites: new Set(['dnc_entries']) })
  const r = await processInbound({ channel: 'sms', from: PHONE, body: 'STOP', provider: 'twilio', providerId: 'SM3' })
  assert.equal(r.optedOut, false)
  assert.equal(r.optOutFailed, true)
})
await t('a non-STOP message never writes an opt-out', async () => {
  reset()
  await processInbound({ channel: 'sms', from: PHONE, body: 'What time works?', provider: 'twilio', providerId: 'SM4' })
  assert.equal(dncUpserts().length, 0)
})

console.log('\nEvery suppression-writing webhook answers 5xx on a failed write')
const src = (p) => readFileSync(p, 'utf8')
await t('twilio inbound', () => assert.match(src('src/app/api/webhooks/twilio/inbound/route.ts'), /if \(result\.optOutFailed\) return NextResponse\.json\([^)]*\{ status: 503 \}\)/))
await t('email inbound', () => assert.match(src('src/app/api/webhooks/email/inbound/route.ts'), /if \(r\.optOutFailed\) return NextResponse\.json\([^)]*\{ status: 503 \}\)/))
await t('twilio status (carrier 21610)', () => assert.match(src('src/app/api/webhooks/twilio/status/route.ts'), /if \(!optOut\.ok\) return NextResponse\.json\([^)]*\{ status: 503 \}\)/))
await t('resend (bounce / complaint)', () => assert.match(src('src/app/api/webhooks/resend/route.ts'), /if \(suppressionFailed\) return NextResponse\.json\([^)]*\{ status: 503 \}\)/))

console.log(`\nAll ${passed} assertions passed.`)
