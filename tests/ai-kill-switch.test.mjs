// M-4 PROOF — the GLOBAL AI gateway kill switch fails CLOSED on a DB read error. The
// pure decision core gatewayEnabledFrom(envDisabled, row, dbError) must return false
// whenever the switch cannot be verified (env override OR DB error) — an unverifiable
// kill switch that runs anyway is not a kill switch. A missing config row (no error) is
// the intentional "not configured yet → enabled" default and stays true.
// Run: node tests/ai-kill-switch.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-killswitch-'))
execSync(
  `npx tsc src/lib/ai/kill-switch.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { gatewayEnabledFrom } = require(join(out, 'kill-switch.js'))

const results = []
function t(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) }
}

t('DB read error → fail CLOSED (false) — the M-4 fix', () => {
  assert.equal(gatewayEnabledFrom(false, null, true), false)
})
t('env AI_GATEWAY_DISABLED → false', () => {
  assert.equal(gatewayEnabledFrom(true, { gateway_enabled: true }, false), false)
})
t('row gateway_enabled=false → false', () => {
  assert.equal(gatewayEnabledFrom(false, { gateway_enabled: false }, false), false)
})
t('no row, no error (unconfigured) → default enabled (true)', () => {
  assert.equal(gatewayEnabledFrom(false, null, false), true)
})
t('row gateway_enabled=true → true', () => {
  assert.equal(gatewayEnabledFrom(false, { gateway_enabled: true }, false), true)
})

const failed = results.filter((r) => !r.pass)
if (failed.length) { console.error(`\n${failed.length} kill-switch assertion(s) FAILED.`); process.exit(1) }
console.log(`\nAll ${results.length} kill-switch proofs passed (M-4: global switch fails closed on DB error).`)
