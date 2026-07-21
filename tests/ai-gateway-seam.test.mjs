// H-1 PROOF — every model call goes through the AI gateway. Only the gateway itself
// and the lazy Anthropic client module may import getAnthropic; every other call site
// must route through runGateway (which enforces the kill switch + provider fallback and
// surfaces token/cost telemetry). A direct getAnthropic() call in a route/lib bypasses
// all of that. Static invariant so a regression is caught in CI.
// Run: node tests/ai-gateway-seam.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'

const ALLOWED = new Set([
  'src/lib/ai/gateway.ts', // the gateway wraps getAnthropic internally (callClaude)
  'src/lib/anthropic.ts',  // defines the lazy getAnthropic client
])

const hits = execSync('grep -rl "getAnthropic" src/ || true', { encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean)

const violations = hits.filter((f) => !ALLOWED.has(f))

console.log('AI gateway seam — files importing getAnthropic:')
for (const f of hits) console.log(`  ${ALLOWED.has(f) ? '✓ allowed ' : '✗ BYPASS  '} ${f}`)

assert.equal(
  violations.length,
  0,
  `These files bypass the AI gateway by calling getAnthropic directly (route them through runGateway): ${violations.join(', ')}`,
)
console.log(`\nOK — no gateway bypass (${hits.length} importer(s), all allowed).`)
