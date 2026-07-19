// tests/fail-closed-auth.test.mjs — the internal-auth "unconfigured" decision.
// Run with: node tests/fail-closed-auth.test.mjs
// The decision is pure TS; we bundle it to JS on the fly via esbuild if available,
// otherwise we skip (build/CI compiles it anyway) — unless CI_REQUIRE_INFRA=1.
//
// Proves the fail-CLOSED posture: when NEITHER FSOS_API_SECRET nor
// FSOS_ADMIN_PASSWORD is configured, internal auth must DENY in production
// (so the command center / internal API is never world-open on a misconfigured
// deploy), while still allowing local/dev to run without secrets.

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let mod
try {
  const dir = mkdtempSync(join(tmpdir(), 'failclosed-'))
  const out = join(dir, 'config-gate.mjs')
  execSync(
    `npx --yes esbuild@0.21.5 src/lib/auth/config-gate.ts --bundle --platform=node --format=esm --outfile=${out}`,
    { stdio: 'ignore' },
  )
  mod = await import(out)
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild is unavailable:', e.message)
    process.exit(1)
  }
  console.log('fail-closed-auth.test.mjs — SKIPPED (esbuild unavailable):', e.message)
  process.exit(0)
}

const { unconfiguredInternalAuthAllowed } = mod

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) {
    pass++
    console.log('  ✓', msg)
  } else {
    fail++
    console.error('  ✗', msg)
  }
}

// Production, no secrets, no escape hatch → DENY (fail closed).
ok(
  unconfiguredInternalAuthAllowed({ NODE_ENV: 'production' }) === false,
  'production with no secrets configured denies (fail closed)',
)

// Production, no secrets, but explicit local escape hatch → allow.
ok(
  unconfiguredInternalAuthAllowed({ NODE_ENV: 'production', ALLOW_INSECURE_LOCAL: '1' }) === true,
  'ALLOW_INSECURE_LOCAL=1 re-opens the unconfigured gate (explicit opt-out)',
)

// Development / no NODE_ENV → allow (local dev keeps working without secrets).
ok(
  unconfiguredInternalAuthAllowed({ NODE_ENV: 'development' }) === true,
  'development with no secrets allows (local dev unbroken)',
)
ok(
  unconfiguredInternalAuthAllowed({}) === true,
  'unset NODE_ENV allows (test/local runners unbroken)',
)

// Vercel deployment with NODE_ENV somehow unset → still DENY (belt-and-suspenders).
ok(
  unconfiguredInternalAuthAllowed({ VERCEL: '1' }) === false,
  'a Vercel deployment denies even if NODE_ENV is unset (VERCEL guard)',
)

// The escape hatch is strict '1' — a stray truthy value must NOT re-open prod.
ok(
  unconfiguredInternalAuthAllowed({ NODE_ENV: 'production', ALLOW_INSECURE_LOCAL: 'true' }) === false,
  "ALLOW_INSECURE_LOCAL='true' (not '1') does NOT re-open production (strict match)",
)

console.log(`\nfail-closed-auth: ${pass} passed, ${fail} failed.`)
if (fail > 0) process.exit(1)
