// Public referral intake must actually insert (audit H-03). It wrote owner_scope='public' into a
// uuid column (live type confirmed), so every public referral failed — and the raw database error
// text went back to the anonymous caller. Drives the real route (esbuild-bundled, fake DB).
// Run: node tests/public-refer-intake.test.mjs
import assert from 'node:assert/strict'
import { bundle, fakeDb, installDb, makeReq } from './helpers/workshop-harness.mjs'

const route = await bundle('src/app/api/public/refer/route.ts')
let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const body = { referred_name: 'Test Person', engagement: 'warm_handoff' }
const post = (b, ip) => route.POST(makeReq('/api/public/refer', { body: b, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } }))

console.log('Public referral intake')
await t('the insert carries owner_scope null (a uuid column), never the actor string', async () => {
  const db = installDb(fakeDb({ referrals: [{ id: 'r1' }] }))
  const res = await post(body, '203.0.113.10')
  assert.equal(res.status, 200)
  const ins = db.calls.find((c) => c.table === 'referrals' && c.method === 'insert')
  assert.ok(ins, 'no referral insert')
  assert.equal(ins.payload.owner_scope, null)
})
await t('a failed insert returns a generic error — no database text to an anonymous caller', async () => {
  installDb(fakeDb({ referrals: [{ __error: { code: '22P02', message: 'invalid input syntax for type uuid: "public"' } }] }))
  const res = await post(body, '203.0.113.11')
  assert.equal(res.status, 500)
  const json = await res.json()
  assert.equal(json.error, 'Failed to submit referral')
  assert.doesNotMatch(JSON.stringify(json), /uuid|syntax|22P02/)
})
console.log(`\nAll ${passed} assertions passed.`)
process.exit(0)
