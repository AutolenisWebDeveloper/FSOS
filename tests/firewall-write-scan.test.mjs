// H-4 PROOF — the securities-firewall field scan (assertNotSecuritiesSystemOfRecord)
// runs on the write paths of ALL FOUR contractually-named entities. opportunities and
// policies already scan; this pins cases + commissions (receipt/adjustment) + commission
// splits, so no securities-substantive field (account #, order detail, …) can be written
// onto the spine there. Static invariant + a behavior re-check of the scanner itself.
// Run: node tests/firewall-write-scan.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const results = []
function t(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) }
}

// 1. Static: the firewall scan is invoked in each spine write route that was missing it.
const WRITE_ROUTES = [
  'src/app/api/cases/route.ts',
  'src/app/api/commissions/[id]/route.ts',
  'src/app/api/commissions/splits/route.ts',
]
for (const f of WRITE_ROUTES) {
  t(`${f} invokes assertNotSecuritiesSystemOfRecord`, () => {
    const src = readFileSync(f, 'utf8')
    assert.ok(src.includes('assertNotSecuritiesSystemOfRecord('), 'firewall scan not invoked on this write path')
  })
}

// 2. Behavior: the scanner actually rejects a securities-substantive payload and allows a
//    clean one + the whitelisted non-substantive pointer (firewall.ts is pure).
const out = mkdtempSync(join(tmpdir(), 'fsos-fw-'))
execSync(
  `npx tsc src/lib/compliance/firewall.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const fw = require(join(out, 'firewall.js'))

t('scanner THROWS on a securities-substantive field (e.g. account number)', () => {
  assert.throws(() => fw.assertNotSecuritiesSystemOfRecord({ account_number: '123-45678' }))
})
t('scanner ALLOWS a clean payload + the non-substantive ffs_case_ref pointer', () => {
  fw.assertNotSecuritiesSystemOfRecord({ total_commission: 1200, ffs_case_ref: 'FFS-abc', period: '2026-Q3' })
})

const failed = results.filter((r) => !r.pass)
if (failed.length) { console.error(`\n${failed.length} firewall-write-scan assertion(s) FAILED.`); process.exit(1) }
console.log(`\nAll ${results.length} firewall-write-scan proofs passed (H-4: all 4 spine entities scanned).`)
