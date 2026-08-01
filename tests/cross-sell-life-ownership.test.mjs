// Cross-Sell Life — advisor-ownership resolution (D7 security).
// Proves the advisor-handoff route can no longer write an unvalidated/arbitrary advisor UUID onto
// an enrollment (which flips it to advisor_owned and STOPS the AI). Ownership defaults to the
// authenticated session user and refuses a body advisor that is not the caller themselves.
// Run: node tests/cross-sell-life-ownership.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-xsell-ownership-'))
execSync(
  `npx tsc src/lib/cross-sell-life/ownership-core.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { resolveAdvisorOwner } = require(join(out, 'ownership-core.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const SELF = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

t('defaults to the session user when no advisor is supplied', () => {
  assert.deepEqual(resolveAdvisorOwner(SELF), { ok: true, advisor: SELF })
  assert.deepEqual(resolveAdvisorOwner(SELF, null), { ok: true, advisor: SELF })
  assert.deepEqual(resolveAdvisorOwner(SELF, ''), { ok: true, advisor: SELF })
})

t('accepts a body advisor that IS the caller (self-acceptance, case-insensitive)', () => {
  assert.deepEqual(resolveAdvisorOwner(SELF, SELF), { ok: true, advisor: SELF })
  assert.deepEqual(resolveAdvisorOwner(SELF, SELF.toUpperCase()), { ok: true, advisor: SELF })
})

t('REJECTS assigning ownership to a different UUID (the stall-automation vector)', () => {
  assert.deepEqual(resolveAdvisorOwner(SELF, OTHER), { ok: false, error: 'advisor_must_be_self' })
})

t('fails closed on a malformed session user id', () => {
  assert.deepEqual(resolveAdvisorOwner('not-a-uuid', SELF), { ok: false, error: 'invalid_session_user' })
  assert.deepEqual(resolveAdvisorOwner(''), { ok: false, error: 'invalid_session_user' })
})

console.log(`\n✓ advisor-ownership resolution: ${passed} assertions passed`)
