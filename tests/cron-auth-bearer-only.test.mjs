// Every /api/cron/* route authorizes on Bearer CRON_SECRET ONLY (owner decision 9, audit
// A-01 / C-07 / J-01). The `x-vercel-cron` header is client-supplied; three of the four routes
// trusted it, so anyone could trigger the live send engines (campaign dispatch, the four campaign
// ticks, booking reminders, social publishing). No secret configured → everything is refused.
// Run: node tests/cron-auth-bearer-only.test.mjs
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { bundle, makeReq } from './helpers/workshop-harness.mjs'

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const saved = process.env.CRON_SECRET
const routes = readdirSync('src/app/api/cron')

console.log('One cron authorization check, Bearer only')
await t('every cron route uses cronAuthorized and none trusts x-vercel-cron', () => {
  assert.deepEqual(routes.sort(), ['[job]', 'booking-reminders', 'social-publish', 'workshop-reminders'])
  for (const r of routes) {
    const src = readFileSync(`src/app/api/cron/${r}/route.ts`, 'utf8')
    assert.match(src, /if \(!cronAuthorized\(req\)\)/, `${r} does not call cronAuthorized`)
    assert.doesNotMatch(src, /headers\.get\('x-vercel-cron'\)/, `${r} still reads x-vercel-cron`)
    assert.doesNotMatch(src, /function authorized\(/, `${r} keeps a private copy of the check`)
  }
})

const http = await bundle('src/lib/http.ts')
const req = (headers) => makeReq('/api/cron/x', { method: 'GET', headers })
await t('cronAuthorized: no secret configured → refused, even with a header and a bearer', () => {
  delete process.env.CRON_SECRET
  assert.equal(http.cronAuthorized(req({ 'x-vercel-cron': '1' })), false)
  assert.equal(http.cronAuthorized(req({ authorization: 'Bearer ' })), false)
  assert.equal(http.cronAuthorized(req({ authorization: 'Bearer undefined' })), false)
})
await t('cronAuthorized: a forged x-vercel-cron header alone is refused', () => {
  process.env.CRON_SECRET = 'test-cron-secret'
  assert.equal(http.cronAuthorized(req({ 'x-vercel-cron': '1' })), false)
  assert.equal(http.cronAuthorized(req({ authorization: 'Bearer wrong' })), false)
})
await t('cronAuthorized: the exact Bearer secret is accepted', () => {
  process.env.CRON_SECRET = 'test-cron-secret'
  assert.equal(http.cronAuthorized(req({ authorization: 'Bearer test-cron-secret' })), true)
})

console.log('\nThe routes themselves answer 401 before doing any work')
const jobRoute = await bundle('src/app/api/cron/[job]/route.ts')
const params = { params: Promise.resolve({ job: 'no-such-job' }) }
await t('[job]: forged header → 401; correct bearer passes auth (unknown job → 404, nothing runs)', async () => {
  process.env.CRON_SECRET = 'test-cron-secret'
  assert.equal((await jobRoute.GET(makeReq('/api/cron/no-such-job', { method: 'GET', headers: { 'x-vercel-cron': '1' } }), params)).status, 401)
  assert.equal((await jobRoute.GET(makeReq('/api/cron/no-such-job', { method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } }), params)).status, 404)
})
for (const r of ['booking-reminders', 'social-publish', 'workshop-reminders']) {
  const route = await bundle(`src/app/api/cron/${r}/route.ts`)
  await t(`${r}: forged x-vercel-cron → 401`, async () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    assert.equal((await route.GET(makeReq(`/api/cron/${r}`, { method: 'GET', headers: { 'x-vercel-cron': '1' } }))).status, 401)
  })
}

if (saved === undefined) delete process.env.CRON_SECRET
else process.env.CRON_SECRET = saved
console.log(`\nAll ${passed} assertions passed.`)
process.exit(0)
