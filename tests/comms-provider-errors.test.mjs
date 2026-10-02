// A provider REJECTION must be classified, recorded truthfully, and — when it is a carrier
// opt-out — honoured even though no status callback will ever follow.
//   • twilioRejection parses Twilio's JSON error body into providerCode + permanent (A-07/B-06).
//   • sendSms hands a synchronous rejection code to the carrier-opt-out writer; Twilio refuses
//     the create call for an already-unsubscribed number (21610) so no callback arrives (B-05).
//   • recordCarrierOptOut applies ONLY 21610 — filtering/unreachable/rate-limit codes are
//     delivery problems, and suppressing on them would silently opt people out.
//   • send.ts records a provider rejection as delivery 'failed', not a compliance 'blocked'.
// Audit A-07 / B-05 / B-06 (docs/ops/automation-inventory.md).
// Run: node tests/comms-provider-errors.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'

const require = createRequire(import.meta.url)
let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

const mod = loadChokepoint('provider-errors')
const { twilioRejection, sendSms } = mod.messaging

console.log('twilioRejection — classify the provider answer')
await t('21610 (unsubscribed) → code + permanent', () => {
  const r = twilioRejection(400, JSON.stringify({ code: 21610, message: 'Attempt to send to unsubscribed recipient' }))
  assert.equal(r.ok, false)
  assert.equal(r.providerCode, '21610')
  assert.equal(r.permanent, true)
  assert.match(r.error, /^Twilio 400 21610: Attempt to send/)
})
await t('21211 invalid number and 21614 non-mobile are permanent', () => {
  for (const code of [21211, 21614]) assert.equal(twilioRejection(400, JSON.stringify({ code })).permanent, true, String(code))
})
await t('a rate limit (20429) is not permanent', () => {
  const r = twilioRejection(429, JSON.stringify({ code: 20429, message: 'Too Many Requests' }))
  assert.equal(r.providerCode, '20429')
  assert.equal(r.permanent, false)
})
await t('a non-JSON body keeps the raw text and claims no code', () => {
  const r = twilioRejection(502, '<html>Bad Gateway</html>')
  assert.equal(r.providerCode, undefined)
  assert.equal(r.permanent, false)
  assert.match(r.error, /^Twilio 502: <html>/)
})

console.log('\nsendSms — a synchronous rejection reaches the carrier-opt-out writer')
withProviderEnv()
const NOON_CT = new Date('2026-10-01T17:00:00Z')
async function runWith(rejection) {
  const { messagingDeps } = makeMessagingDeps(mod, {}, { now: NOON_CT })
  const optOuts = []
  messagingDeps.deliverSms = async () => rejection
  messagingDeps.recordCarrierOptOut = async (to, code) => { optOuts.push({ to, code }) }
  const res = await sendSms('+12145550188', 'Your review is confirmed for Tuesday.', 'mid-1',
    { policy: { actor: 'test', purpose: 'TRANSACTIONAL' } }, messagingDeps)
  return { res, optOuts }
}
await t('21610 at send time → the writer is called with the recipient and code', async () => {
  const { res, optOuts } = await runWith(twilioRejection(400, JSON.stringify({ code: 21610, message: 'unsubscribed' })))
  assert.equal(res.ok, false)
  assert.equal(res.providerCode, '21610')
  assert.deepEqual(optOuts, [{ to: '+12145550188', code: '21610' }])
})
await t('a successful send never calls the writer', async () => {
  const { optOuts } = await runWith({ ok: true, id: 'SM1' })
  assert.equal(optOuts.length, 0)
})
await t('a rejection without a provider code (network error) never calls the writer', async () => {
  const { optOuts } = await runWith({ ok: false, error: 'ECONNRESET' })
  assert.equal(optOuts.length, 0)
})

console.log('\nrecordCarrierOptOut — only the unambiguous unsubscribe suppresses')
const out = mkdtempSync(join(tmpdir(), 'fsos-carrier-optout-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
try {
  execSync(
    `npx tsc src/lib/comms/opt-out.ts --rootDir src --outDir ${out} --module commonjs ` +
      `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch { /* unresolved '@/…' aliases are expected */ }
const entry = join(out, 'lib/comms/opt-out.js')
if (!existsSync(entry)) { console.error('FATAL: opt-out.js was not emitted'); process.exit(1) }
const writes = []
const db = {
  from(table) {
    const q = {
      upsert(row) { writes.push({ table, op: 'upsert', row }); return Promise.resolve({ error: null }) },
      insert(row) { writes.push({ table, op: 'insert', row }); return Promise.resolve({ error: null }) },
      update(row) { writes.push({ table, op: 'update', row }); return q },
      eq() { return q },
      then(res, rej) { return Promise.resolve({ error: null }).then(res, rej) },
    }
    return q
  },
}
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request.endsWith('/supabase/client')) return { __esModule: true, getDb: () => db }
  if (request === './conversations' || request.endsWith('/comms/conversations')) {
    return { __esModule: true, normalizeContact: (_c, v) => v, resolveContact: async () => ({ memberId: 'm1', householdId: 'h1' }) }
  }
  if (request === './consent-events' || request.endsWith('/consent-events')) {
    return { __esModule: true, recordConsentChange: async () => { writes.push({ table: 'consent_change' }) } }
  }
  return origLoad.call(this, request, ...rest)
}
const { recordCarrierOptOut } = require(entry)
await t('21610 writes the DNC row, the contact revoke and the member revoke', async () => {
  writes.length = 0
  await recordCarrierOptOut('+12145550188', '21610')
  const tables = writes.map((w) => w.table)
  assert.ok(tables.includes('dnc_entries'))
  assert.ok(tables.includes('comm_contact_consents'))
  assert.ok(tables.includes('consents'))
  assert.match(writes.find((w) => w.table === 'dnc_entries').row.reason, /^Twilio ErrorCode 21610/,
    'the reason prefix is what lets a later bare START restore a keyword/carrier opt-out (decision 4)')
})
await t('filtering / unreachable / rate-limit / invalid-number codes write nothing', async () => {
  for (const code of ['30007', '30003', '20429', '21211', '21614']) {
    writes.length = 0
    await recordCarrierOptOut('+12145550188', code)
    assert.equal(writes.length, 0, `${code} suppressed the number`)
  }
})

console.log('\nThe send record and the status webhook use the same classification')
const sendSrc = readFileSync('src/lib/comms/send.ts', 'utf8')
await t("send.ts records a cleared-but-rejected send as 'failed', a policy withhold as 'blocked'", () => {
  assert.match(sendSrc, /const providerRejected = !result\.sent && result\.gate\.allowed/)
  assert.match(sendSrc, /result\.sent \? 'sent' : providerRejected \? 'failed' : 'blocked'/)
})
await t('the Twilio status webhook delegates to the same carrier-opt-out writer', () => {
  const route = readFileSync('src/app/api/webhooks/twilio/status/route.ts', 'utf8')
  assert.match(route, /await recordCarrierOptOut\(params\.To, String\(params\.ErrorCode\)\)/)
})

console.log(`\nAll ${passed} assertions passed.`)
