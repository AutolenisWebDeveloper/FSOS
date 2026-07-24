// FNA prefill-mapping proof (build instruction §5, Slice 4). Compiles the PURE
// prefill mapper standalone and asserts it derives suggested inputs from FSOS
// household data, respects the securities firewall (never maps a securities
// policy), and labels every suggestion 'imported'. Offline.
// Run: node tests/fna-prefill.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.fna-prefill-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(`npx tsc src/lib/fna/prefill.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`, { stdio: 'inherit' })
const require = createRequire(import.meta.url)
const { mapContextToInputs } = require(join(out, 'prefill.js'))

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push([name, 'PASS', ''])
  } catch (e) {
    results.push([name, 'FAIL', e.message])
  }
}

check('sums non-securities life coverage and takes the oldest age', () => {
  const s = mapContextToInputs({
    members: [{ age: 42 }, { age: 39 }, { age: null }],
    policies: [
      { is_security: false, face_amount: 250000 },
      { is_security: false, face_amount: 100000 },
    ],
  })
  const cov = s.find((x) => x.key === 'existing_life_coverage')
  const age = s.find((x) => x.key === 'current_age')
  assert.equal(cov.value_numeric, 350000)
  assert.equal(cov.source_label, 'imported')
  assert.equal(cov.section, 'coverage')
  assert.equal(age.value_numeric, 42)
  assert.equal(age.section, 'household')
})

check('NEVER maps a securities policy (firewall §4.1)', () => {
  const s = mapContextToInputs({
    members: [{ age: 50 }],
    policies: [
      { is_security: true, face_amount: 500000 }, // must be excluded
      { is_security: false, face_amount: 200000 },
    ],
  })
  const cov = s.find((x) => x.key === 'existing_life_coverage')
  assert.equal(cov.value_numeric, 200000, 'securities face amount must not be included')
})

check('omits fields with no source data', () => {
  const s = mapContextToInputs({ members: [{ age: null }], policies: [{ is_security: false, face_amount: null }] })
  assert.equal(s.length, 0, 'no derivable values → no suggestions')
})

check('every suggestion is labeled imported (a starting value to confirm)', () => {
  const s = mapContextToInputs({ members: [{ age: 60 }], policies: [{ is_security: false, face_amount: 100000 }] })
  assert.ok(s.length > 0)
  assert.ok(s.every((x) => x.source_label === 'imported'))
})

const width = Math.max(...results.map((r) => r[0].length))
console.log('\nFNA prefill-mapping proof\n' + '─'.repeat(width + 14))
for (const [name, status, detail] of results) console.log(`${status === 'PASS' ? '✓' : '✗'} ${name.padEnd(width)}  ${status}${detail ? '  — ' + detail : ''}`)
const failed = results.filter((r) => r[1] === 'FAIL')
console.log('─'.repeat(width + 14))
console.log(`${results.length - failed.length}/${results.length} passed\n`)
if (failed.length) process.exit(1)
