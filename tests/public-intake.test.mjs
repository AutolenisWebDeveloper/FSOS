// Public-intake defense proof (docs/legacy-port.md §2.3 / §2.5 acceptance:
// "public forms capture consent + honeypot + rate limit"). Compiles the pure
// rate-limiter standalone and asserts the fixed-window limit + per-key isolation
// that guards the client-form and workshop-registration public routes. No server.
// Run: node tests/public-intake.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-intake-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(
  `npx tsc src/lib/http/rate-limit.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { rateLimit, clientIp } = require(join(out, 'rate-limit.js'))

let passed = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  console.log(`  ✓ ${name}`)
  passed++
}

console.log('\nPublic-intake rate limiter')

// 5 requests allowed in the window, the 6th blocked.
const key = 'form-submit:203.0.113.7'
for (let i = 1; i <= 5; i++) ok(`request ${i}/5 allowed`, rateLimit(key, 5, 60_000) === true)
ok('6th request in window blocked', rateLimit(key, 5, 60_000) === false)
ok('still blocked while window is open', rateLimit(key, 5, 60_000) === false)

// A different key (different IP / different surface) is independent.
ok('different key is not rate-limited', rateLimit('workshop-reg:198.51.100.2', 5, 60_000) === true)

// limit=1 with a REAL window: first request allowed, second blocked. Using a
// 60s window keeps this deterministic — the window cannot expire between the two
// synchronous calls (the old 1ms window here flaked on loaded CI runners).
const burstKey = 'burst:key'
ok('first request in window allowed', rateLimit(burstKey, 1, 60_000) === true)
ok('second immediate request blocked', rateLimit(burstKey, 1, 60_000) === false)

// A short window expires and re-allows. Separate key + a window we then wait PAST
// deterministically (busy-wait, since this harness has no async timers) — we only
// assert the roll-over after actively spinning beyond resetAt, so it cannot flake.
const rollKey = 'roll:key'
ok('first request in short window allowed', rateLimit(rollKey, 1, 5) === true)
const until = Date.now() + 25
while (Date.now() < until) {
  /* spin well past the 5ms window so it is guaranteed to have rolled over */
}
ok('request allowed again after the window rolls over', rateLimit(rollKey, 1, 60_000) === true)

// clientIp prefers x-forwarded-for's first hop, falls back to x-real-ip, then unknown.
const ipFwd = clientIp(new Request('https://x', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }))
ok('clientIp uses first x-forwarded-for hop', ipFwd === '203.0.113.9')
const ipReal = clientIp(new Request('https://x', { headers: { 'x-real-ip': '198.51.100.5' } }))
ok('clientIp falls back to x-real-ip', ipReal === '198.51.100.5')
const ipNone = clientIp(new Request('https://x'))
ok('clientIp defaults to unknown', ipNone === 'unknown')

console.log(`\n${passed} public-intake assertions passed.\n`)
