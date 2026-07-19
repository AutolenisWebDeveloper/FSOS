// GDC tier-math proof (docs/legacy-port.md §2.2 acceptance: "tier math matches
// config"). Compiles the PURE, dependency-free tier core and asserts the band
// boundaries, next-tier walk, distance-to-next, and estimated payout against the
// seeded assumption-flagged config — with no live Supabase.
// Run: node tests/gdc-tier.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.gdc-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(
  `npx tsc src/lib/data/gdc-tiers.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
// A single source file compiles flat into outDir (rootDir = the file's own dir).
const { pickGdcTier, nextGdcTier, computeGdcTier } = require(join(out, 'gdc-tiers.js'))

// Seeded config (migration 016) — assumption-flagged; NOT Farmers-published figures.
// Half-open bands [min, max): each max_gdc equals the next tier's min_gdc.
const TIERS = [
  { tier_no: 1, label: 'Tier 1', min_gdc: 0, max_gdc: 15000, payout_pct: 40, is_assumption: true },
  { tier_no: 2, label: 'Tier 2', min_gdc: 15000, max_gdc: 55000, payout_pct: 60, is_assumption: true },
  { tier_no: 3, label: 'Tier 3', min_gdc: 55000, max_gdc: null, payout_pct: 80, is_assumption: true },
]

const results = []
function check(name, fn) {
  try {
    fn()
    results.push([name, 'PASS', ''])
  } catch (e) {
    results.push([name, 'FAIL', e.message])
  }
}

// ── Band boundaries ──────────────────────────────────────────────────────────
check('floor of tier 1 → Tier 1', () => assert.equal(pickGdcTier(0, TIERS).tier_no, 1))
check('just below tier-2 floor → Tier 1', () => assert.equal(pickGdcTier(14999.99, TIERS).tier_no, 1))
check('exactly $15,000 → Tier 2 (upper band owns boundary)', () => assert.equal(pickGdcTier(15000, TIERS).tier_no, 2))
check('just below tier-3 floor → Tier 2', () => assert.equal(pickGdcTier(54999.99, TIERS).tier_no, 2))
check('exactly $55,000 → Tier 3', () => assert.equal(pickGdcTier(55000, TIERS).tier_no, 3))
check('open-ended top → Tier 3', () => assert.equal(pickGdcTier(1_000_000, TIERS).tier_no, 3))
check('below lowest floor → Tier 1', () => assert.equal(pickGdcTier(-100, TIERS).tier_no, 1))

// ── Next-tier walk ───────────────────────────────────────────────────────────
check('next(Tier 1) → Tier 2', () => assert.equal(nextGdcTier(TIERS[0], TIERS).tier_no, 2))
check('next(Tier 2) → Tier 3', () => assert.equal(nextGdcTier(TIERS[1], TIERS).tier_no, 3))
check('next(Tier 3) → null (top)', () => assert.equal(nextGdcTier(TIERS[2], TIERS), null))

// ── computeGdcTier (distance + estimated payout) ─────────────────────────────
check('mid-tier-2 math', () => {
  const m = computeGdcTier(20000, TIERS)
  assert.equal(m.current.tier_no, 2)
  assert.equal(m.next.tier_no, 3)
  assert.equal(m.distanceToNext, 35000) // 55000 - 20000
  assert.equal(m.estimatedPayout, 12000) // 20000 * 60%
})
check('top-tier math (no next, no distance)', () => {
  const m = computeGdcTier(60000, TIERS)
  assert.equal(m.current.tier_no, 3)
  assert.equal(m.next, null)
  assert.equal(m.distanceToNext, 0)
  assert.equal(m.estimatedPayout, 48000) // 60000 * 80%
})

// ── Degenerate config ────────────────────────────────────────────────────────
check('no tiers → null current, zero payout', () => {
  const m = computeGdcTier(50000, [])
  assert.equal(m.current, null)
  assert.equal(m.estimatedPayout, 0)
})
check('gap in bands → highest floor ≤ gdc', () => {
  const gapped = [
    { tier_no: 1, label: 'A', min_gdc: 0, max_gdc: 10, payout_pct: 10, is_assumption: true },
    { tier_no: 2, label: 'B', min_gdc: 20, max_gdc: 30, payout_pct: 20, is_assumption: true },
  ]
  assert.equal(pickGdcTier(15, gapped).tier_no, 1)
})

// ── Report ───────────────────────────────────────────────────────────────────
const width = Math.max(...results.map((r) => r[0].length))
console.log('\nGDC tier-math proof\n' + '─'.repeat(width + 14))
for (const [name, status, detail] of results) {
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${name.padEnd(width)}  ${status}${detail ? '  — ' + detail : ''}`)
}
const failed = results.filter((r) => r[1] === 'FAIL')
console.log('─'.repeat(width + 14))
console.log(`${results.length - failed.length}/${results.length} passed\n`)
if (failed.length) process.exit(1)
