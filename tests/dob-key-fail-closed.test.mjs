// C-1 PROOF — the DOB encryption key fails CLOSED in a deployed runtime.
// dobKey() historically returned a committed dev default when unset, so a
// misconfigured production deploy would encrypt client household_members DOB with a
// publicly-known key. This proves resolveDobKey() refuses the default when deployed
// and only yields it in local/dev (or under the explicit ALLOW_INSECURE_LOCAL opt-out).
// Compiles the pure decision (lib/data/dob-key.ts) — no Supabase/Next needed.
// Run: node tests/dob-key-fail-closed.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-dobkey-'))
execSync(
  `npx tsc src/lib/data/dob-key.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { resolveDobKey, DEV_DOB_KEY_DEFAULT } = require(join(out, 'dob-key.js'))

let passed = 0
const ok = (cond, msg) => {
  assert.ok(cond, msg)
  console.log('  ✓ ' + msg)
  passed++
}

// 1. Explicit key wins everywhere (primary + alias), even in production.
ok(
  resolveDobKey({ NODE_ENV: 'production', DOB_ENCRYPTION_KEY: 'real-secret' }).key === 'real-secret',
  'explicit DOB_ENCRYPTION_KEY is used in production',
)
ok(
  resolveDobKey({ NODE_ENV: 'production', FSOS_DOB_KEY: 'alias-secret' }).key === 'alias-secret',
  'alias FSOS_DOB_KEY is honored',
)

// 2. Deployed + unset => FAIL CLOSED (no default handed back).
const prod = resolveDobKey({ NODE_ENV: 'production' })
ok(prod.ok === false, 'production + no key => fail closed (ok:false)')
ok(/not set/i.test(prod.reason), 'fail-closed result carries an actionable reason')

const vercel = resolveDobKey({ VERCEL: '1' })
ok(vercel.ok === false, 'any Vercel deploy (preview incl.) + no key => fail closed')

// 3. Local/dev keeps the dev default so DX is unchanged.
const dev = resolveDobKey({ NODE_ENV: 'development' })
ok(dev.ok === true && dev.key === DEV_DOB_KEY_DEFAULT, 'local/dev falls back to the dev default')

// 4. Explicit escape hatch re-opens the default on a deploy (rare, intentional).
const optout = resolveDobKey({ NODE_ENV: 'production', ALLOW_INSECURE_LOCAL: '1' })
ok(optout.ok === true && optout.key === DEV_DOB_KEY_DEFAULT, 'ALLOW_INSECURE_LOCAL=1 opt-out re-enables the default')

// 5. The committed default must NEVER be reachable on a plain production runtime.
ok(
  resolveDobKey({ NODE_ENV: 'production' }).ok === false,
  'the shared dev default is unreachable on a plain production runtime',
)

console.log(`\nAll ${passed} DOB-key fail-closed assertions passed.`)
