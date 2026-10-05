// Follow-up R17c: the three static cron routes (booking-reminders, social-publish,
// workshop-reminders) bypass /api/cron/[job]'s runIdempotent, so they recorded no job_runs row and
// the Jobs page could only say "Runs on its own route; not recorded here". Each now records its
// latest run (one row per route, refreshed every tick): completed, or errored with the reason.
// Run: node tests/static-cron-routes-record-run.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, installDb, makeReq } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fsos-r17c-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const stub = (name, src) => { const p = join(dir, name); writeFileSync(p, src); return p }
const notify = stub('notify.mjs', `export async function runBookingReminderPass() { if (globalThis.__fail) throw new Error('ledger read failed'); return { scanned: 0, sent: 0, deferred: 0, skipped: 0 } }
export async function runBookingNoticeRetryPass() { return { scanned: 0, sent: 0, deferred: 0, skipped: 0 } }`)
const publisher = stub('publisher.mjs', `export async function publishDueEntries() { if (globalThis.__fail) throw new Error('queue read failed'); return { processed: 0, published: 0, retriedOrHeld: 0, deadLettered: 0, skipped: 0 } }`)
const engine = stub('engine.mjs', `const r = () => (globalThis.__fail ? { ok: false, handled: 0, note: 'query failed' } : { ok: true, handled: 0 })
export async function runChangePass() { return r() }
export async function runReminderPass() { return r() }
export async function runNurturePass() { return r() }`)

const ROUTES = [
  ['booking-reminders', { '@/lib/booking/notify': notify }],
  ['social-publish', { '@/lib/social/publisher': publisher }],
  ['workshop-reminders', { '@/lib/workshops/comms-engine': engine }],
]
process.env.CRON_SECRET = 'test-cron-secret'
const req = (r) => makeReq(`/api/cron/${r}`, { method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })

let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('Static cron routes record their latest run')
for (const [route, aliases] of ROUTES) {
  const mod = await bundle(`src/app/api/cron/${route}/route.ts`, { aliases })
  await t(`${route}: a run is recorded completed, and a later failure is recorded errored`, async () => {
    const db = memDb(); installDb(db)
    globalThis.__fail = false
    await mod.GET(req(route))
    let rows = db.rows('job_runs').filter((r) => r.job === route)
    assert.equal(rows.length, 1, 'one job_runs row for the route')
    assert.equal(rows[0].status, 'completed')
    globalThis.__fail = true
    const res = await mod.GET(req(route))
    assert.equal(res.status, 500)
    rows = db.rows('job_runs').filter((r) => r.job === route)
    assert.equal(rows.length, 1, 'refreshed, not appended')
    assert.equal(rows[0].status, 'errored')
    assert.ok(rows[0].error)
  })
}
await t('the Jobs page reads a static route\'s run by its route name', () => {
  const src = readFileSync('src/app/(super)/super/jobs/page.tsx', 'utf8')
  assert.doesNotMatch(src, /not recorded here/)
  assert.match(src, /a\.trigger\.kind === 'cron_route' \? a\.trigger\.route/)
})

if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
