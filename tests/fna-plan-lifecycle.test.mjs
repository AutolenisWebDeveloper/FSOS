// FNA plan/version lifecycle proof (ADR-016). Compiles the PURE lifecycle core
// (src/lib/fna/plan-lifecycle.ts — no imports, no I/O) standalone and asserts the
// status state machine, client-presentability gate, version numbering, and
// conflict detection. No live Supabase (same offline pattern as gdc-tier).
// Run: node tests/fna-plan-lifecycle.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.fna-lifecycle-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(
  `npx tsc src/lib/fna/plan-lifecycle.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { canTransition, isPresentableToClient, nextVersionNo, detectConflicts } = require(join(out, 'plan-lifecycle.js'))

const results = []
function check(name, fn) {
  try {
    fn()
    results.push([name, 'PASS', ''])
  } catch (e) {
    results.push([name, 'FAIL', e.message])
  }
}

// ── Status state machine ─────────────────────────────────────────────────────
check('valid forward transitions', () => {
  assert.equal(canTransition('DRAFT', 'IN_PROGRESS'), true)
  assert.equal(canTransition('IN_PROGRESS', 'CALCULATED'), true)
  assert.equal(canTransition('CALCULATED', 'UNDER_REVIEW'), true)
  assert.equal(canTransition('UNDER_REVIEW', 'APPROVED'), true)
  assert.equal(canTransition('APPROVED', 'SUPERSEDED'), true)
  assert.equal(canTransition('SUPERSEDED', 'ARCHIVED'), true)
})
check('invalid skips are rejected', () => {
  assert.equal(canTransition('DRAFT', 'APPROVED'), false)
  assert.equal(canTransition('DRAFT', 'CALCULATED'), false)
  assert.equal(canTransition('APPROVED', 'DRAFT'), false)
  assert.equal(canTransition('ARCHIVED', 'DRAFT'), false)
})
check('send-back edges allowed', () => {
  assert.equal(canTransition('UNDER_REVIEW', 'CALCULATED'), true)
  assert.equal(canTransition('CALCULATED', 'IN_PROGRESS'), true)
})
check('only APPROVED is client-presentable', () => {
  assert.equal(isPresentableToClient('APPROVED'), true)
  for (const s of ['DRAFT', 'IN_PROGRESS', 'CALCULATED', 'UNDER_REVIEW', 'SUPERSEDED', 'ARCHIVED']) {
    assert.equal(isPresentableToClient(s), false, `${s} must not be presentable`)
  }
})

// ── Version numbering ────────────────────────────────────────────────────────
check('nextVersionNo starts at 1 then increments from the max', () => {
  assert.equal(nextVersionNo([]), 1)
  assert.equal(nextVersionNo([1, 2, 3]), 4)
  assert.equal(nextVersionNo([3, 1, 2]), 4)
  assert.equal(nextVersionNo([5]), 6)
})

// ── Conflict detection ───────────────────────────────────────────────────────
check('no conflict for a single value per fact', () => {
  const c = detectConflicts([{ section: 'income', key: 'monthly_income', value_numeric: 8000 }])
  assert.equal(c.length, 0)
})
check('conflict when two distinct values for the same fact', () => {
  const c = detectConflicts([
    { section: 'income', key: 'monthly_income', value_numeric: 8000, source_label: 'client_supplied' },
    { section: 'income', key: 'monthly_income', value_numeric: 9000, source_label: 'imported' },
  ])
  assert.equal(c.length, 1)
  assert.equal(c[0].kind, 'conflicting')
  assert.equal(c[0].severity, 'warning') // surfaced, never a blocker (§0.B)
  assert.equal(c[0].section, 'income')
  assert.equal(c[0].key, 'monthly_income')
})
check('identical values are NOT a conflict', () => {
  const c = detectConflicts([
    { section: 'assets', key: 'home_value', value_numeric: 500000 },
    { section: 'assets', key: 'home_value', value_numeric: 500000 },
  ])
  assert.equal(c.length, 0)
})
check('blank/absent second value is ignored', () => {
  const c = detectConflicts([
    { section: 'income', key: 'bonus', value_numeric: 10000 },
    { section: 'income', key: 'bonus', value_numeric: null, value_text: '' },
  ])
  assert.equal(c.length, 0)
})
check('same key for different members is not a conflict', () => {
  const c = detectConflicts([
    { section: 'income', key: 'salary', member_id: 'm1', value_numeric: 60000 },
    { section: 'income', key: 'salary', member_id: 'm2', value_numeric: 80000 },
  ])
  assert.equal(c.length, 0)
})

// ── Report ───────────────────────────────────────────────────────────────────
const width = Math.max(...results.map((r) => r[0].length))
console.log('\nFNA plan/version lifecycle proof\n' + '─'.repeat(width + 14))
for (const [name, status, detail] of results) {
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${name.padEnd(width)}  ${status}${detail ? '  — ' + detail : ''}`)
}
const failed = results.filter((r) => r[1] === 'FAIL')
console.log('─'.repeat(width + 14))
console.log(`${results.length - failed.length}/${results.length} passed\n`)
if (failed.length) process.exit(1)
