// Follow-up R5: an opt-out that did not land is never reported as done. The unsubscribe link (GET),
// the RFC 8058 one-click (POST) and the /unsubscribe page's POST answer a retryable 503 when the
// enforced DNC write fails, as the inbound / webhook callers already do. /api/public/consent writes
// its revoke evidence BEFORE re-arming the DNC row — armDncEntry's own order — so a START that runs
// in between always sees the evidence.
// Run: node tests/optout-routes-fail-closed.test.mjs
import assert from 'node:assert/strict'
import { bundle, installDb, makeReq } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

process.env.UNSUBSCRIBE_SECRET = 'r5-secret'
process.env.NEXT_PUBLIC_SITE_URL = 'https://fsos.test'
globalThis.fetch = async () => { throw new Error('network disabled') }

let passed = 0
const at = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

const unsub = await bundle('src/lib/comms/unsubscribe.ts')
const oneClick = await bundle('src/app/api/comms/unsubscribe/route.ts')
const optOutPage = await bundle('src/app/api/consent/opt-out/route.ts')
const publicConsent = await bundle('src/app/api/public/consent/route.ts')

const EMAIL = 'pat@example.com'
const failDnc = (st) => st.table === 'dnc_entries' && st.method !== 'select'
// The signed one-click URL is the https entry of the List-Unsubscribe header.
const linkFor = (contact) => new URL(/<(https:[^>]+)>/.exec(unsub.emailListUnsubscribeHeaders(contact)['List-Unsubscribe'])[1])
const nextReq = (url, method) => { const r = makeReq(url.toString(), { method }); r.nextUrl = new URL(url.toString()); return r }

console.log('Opt-out routes report a failed DNC write as a retryable error')
await at('one-click POST → 503 when the DNC write fails; 200 when it lands', async () => {
  installDb(memDb({ failOn: failDnc }))
  assert.equal((await oneClick.POST(nextReq(linkFor(EMAIL), 'POST'))).status, 503)
  const ok = memDb(); installDb(ok)
  assert.equal((await oneClick.POST(nextReq(linkFor(EMAIL), 'POST'))).status, 200)
  assert.ok(ok.rows('dnc_entries').length > 0)
})
await at('unsubscribe link GET → 503 (not the "done" page) when the DNC write fails', async () => {
  installDb(memDb({ failOn: failDnc }))
  const res = await oneClick.GET(nextReq(linkFor(EMAIL), 'GET'))
  assert.equal(res.status, 503)
  assert.ok(!String(res.headers.get('location') ?? '').includes('done=1'))
  installDb(memDb())
  const okRes = await oneClick.GET(nextReq(linkFor(EMAIL), 'GET'))
  assert.equal(okRes.status, 303)
  assert.match(String(okRes.headers.get('location')), /done=1/)
})
await at('/unsubscribe page POST → 503 when the DNC write fails', async () => {
  installDb(memDb({ failOn: failDnc }))
  const res = await optOutPage.POST(makeReq('/api/consent/opt-out', { body: { contact: EMAIL, channel: 'email' } }))
  assert.equal(res.status, 503)
  installDb(memDb())
  assert.equal((await optOutPage.POST(makeReq('/api/consent/opt-out', { body: { contact: EMAIL, channel: 'email' } }))).status, 200)
})
await at('/api/public/consent writes the revoke evidence before it re-arms the DNC row', async () => {
  const db = memDb(); installDb(db)
  const res = await publicConsent.POST(makeReq('/api/public/consent', { body: { contact: EMAIL, channel: 'email', action: 'opt_out' }, headers: { 'x-forwarded-for': '10.9.9.9' } }))
  assert.equal(res.status, 200)
  const evidenceAt = db.calls.findIndex((c) => c.table === 'comm_contact_consents' && c.method === 'insert')
  const dncAt = db.calls.findIndex((c) => c.table === 'dnc_entries' && c.method !== 'select')
  assert.ok(evidenceAt >= 0 && dncAt >= 0, 'both writes happen')
  assert.ok(evidenceAt < dncAt, `evidence (call ${evidenceAt}) must precede the DNC re-arm (call ${dncAt})`)
})
console.log(`\nAll ${passed} assertions passed.`)
