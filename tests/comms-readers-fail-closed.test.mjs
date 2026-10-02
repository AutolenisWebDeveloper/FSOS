// The chokepoint's contact-resolvable consent / DNC readers must FAIL CLOSED when Supabase
// RETURNS an error. supabase-js does not throw on a PostgREST/HTTP failure — it resolves to
// { data: null, error } — so a try/catch alone never fires and `null` data read as "not on
// DNC" / "not revoked". This file proves every branch returns the RESTRICTIVE answer on a
// returned error, and keeps the permissive answer on a clean empty result.
// Audit finding A-02 / B-01 (docs/ops/automation-inventory.md); CLAUDE.md "Fail closed".
// Run: node tests/comms-readers-fail-closed.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const out = mkdtempSync(join(tmpdir(), 'fsos-readers-fc-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})
try {
  execSync(
    `npx tsc src/lib/comms/contact-consent-read.ts --rootDir src --outDir ${out} --module commonjs ` +
      `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
    { stdio: 'ignore' },
  )
} catch { /* unresolved '@/…' aliases are expected */ }
const entry = join(out, 'lib/comms/contact-consent-read.js')
if (!existsSync(entry)) { console.error('FATAL: contact-consent-read.js was not emitted'); process.exit(1) }

// A query builder whose every terminal await resolves to `result`. Chain methods return itself.
let result = { data: null, error: null }
function builder() {
  const b = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve(result).then(res, rej)
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(result)
      return () => b
    },
  })
  return b
}
const db = { from: () => builder() }
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request.endsWith('/supabase/client')) return { __esModule: true, getDb: () => db }
  return origLoad.call(this, request, ...rest)
}
const { isOnDNC, contactConsentRevoked, durableContactConsentGranted } = require(entry)

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const ERR = { data: null, error: { message: 'canceling statement due to statement timeout' } }
const EMPTY = { data: [], error: null }
const EMPTY_ONE = { data: null, error: null }

console.log('Chokepoint readers fail closed on a returned Supabase error')
await t('isOnDNC(sms, full number) → true on error', async () => { result = ERR; assert.equal(await isOnDNC('+15125551234', 'sms'), true) })
await t('isOnDNC(sms, short number) → true on error', async () => { result = ERR; assert.equal(await isOnDNC('55512', 'sms'), true) })
await t('isOnDNC(email) → true on error', async () => { result = ERR; assert.equal(await isOnDNC('a@example.com', 'email'), true) })
await t('isOnDNC → false on a clean empty result (no regression)', async () => { result = EMPTY; assert.equal(await isOnDNC('+15125551234', 'sms'), false) })
await t('contactConsentRevoked(member) → true on error', async () => { result = ERR; assert.equal(await contactConsentRevoked('m1', '+15125551234', 'sms'), true) })
await t('contactConsentRevoked(no member, email) → true on error', async () => { result = ERR; assert.equal(await contactConsentRevoked(null, 'a@example.com', 'email'), true) })
await t('contactConsentRevoked → false on a clean empty result', async () => { result = EMPTY_ONE; assert.equal(await contactConsentRevoked(null, '+15125551234', 'sms'), false) })
await t('durableContactConsentGranted(sms) → false on error', async () => { result = ERR; assert.equal(await durableContactConsentGranted('+15125551234', 'sms'), false) })
await t('durableContactConsentGranted(email) → false on error', async () => { result = ERR; assert.equal(await durableContactConsentGranted('a@example.com', 'email'), false) })

console.log(`\nAll ${passed} assertions passed.`)
