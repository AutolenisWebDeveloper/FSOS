// Follow-up R19: the super-admin consent POPULATION tool grants SMS and email consent to every member
// without an opt-out. Its execute path (POST without dry_run) is behind an off-by-default switch until
// counsel signs off on the consent basis. The dry run stays available.
// Run: node tests/consent-backfill-switch.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, installDb, makeReq } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fsos-r19-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const auth = join(dir, 'auth.mjs')
writeFileSync(auth, `export async function requireApiRole() { return { ok: true, session: { userId: 'super-1' } } }
export function actorOf() { return 'user:super-1' }`)
const run = join(dir, 'run.mjs')
writeFileSync(run, `export async function runConsentPopulation(o) { (globalThis.__runs ??= []).push(o); return { dryRun: o.dryRun } }`)
const route = await bundle('src/app/api/super/consent/backfill/route.ts', { aliases: { '@/lib/auth/api': auth, '@/lib/comms/consent-population-run': run } })

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const post = (body) => route.POST(makeReq('/api/super/consent/backfill', { body }))
console.log('Consent population: execute is behind an off-by-default switch')
await t('switch absent (off): POST execute is refused and writes nothing', async () => {
  installDb(memDb()); globalThis.__runs = []
  const res = await post({})
  assert.equal(res.status, 403)
  assert.equal(globalThis.__runs.filter((r) => r.dryRun === false).length, 0, 'the population ran')
})
await t('the dry run still works with the switch off (GET and POST dry_run)', async () => {
  installDb(memDb()); globalThis.__runs = []
  assert.equal((await route.GET()).status, 200)
  assert.equal((await post({ dry_run: true })).status, 200)
  assert.ok(globalThis.__runs.length === 2 && globalThis.__runs.every((r) => r.dryRun === true))
})
await t('canary is not "on": execute is still refused', async () => {
  const db = memDb(); installDb(db); db.seed('automation_switches', [{ key: 'consent_population_execute', mode: 'canary' }]); globalThis.__runs = []
  assert.equal((await post({})).status, 403)
})
await t('switch on: POST executes', async () => {
  const db = memDb(); installDb(db); db.seed('automation_switches', [{ key: 'consent_population_execute', mode: 'on' }]); globalThis.__runs = []
  assert.equal((await post({})).status, 200)
  assert.equal(globalThis.__runs[0].dryRun, false)
})
console.log(`\nAll ${passed} assertions passed.`)
