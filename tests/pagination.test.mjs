// Shared list pagination math (src/lib/data/paginate.ts) — pure, DB-free. Proves the
// slice arithmetic and the spec's edge cases: accurate 1-based from/to counts, page-size
// changes, and an out-of-range page (filters shrank the set / rows deleted) clamping to the
// last valid page instead of a blank table. Run: node tests/pagination.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-paginate-'))
execSync(
  `npx tsc src/lib/data/paginate.ts --outDir ${out} ` +
    `--rootDir src/lib/data --module commonjs --target es2020 --moduleResolution node ` +
    `--skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { paginate } = require(join(out, 'paginate.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const seq = (n) => Array.from({ length: n }, (_, i) => i + 1)

t('first page: correct slice and 1-based from/to', () => {
  const p = paginate(seq(340), 0, 50)
  assert.deepEqual(p.items, seq(50))
  assert.equal(p.from, 1)
  assert.equal(p.to, 50)
  assert.equal(p.total, 340)
  assert.equal(p.pageCount, 7)
  assert.equal(p.page, 0)
})

t('middle page: from/to reflect the offset', () => {
  const p = paginate(seq(340), 1, 50) // second page (0-based)
  assert.equal(p.items[0], 51)
  assert.equal(p.items[p.items.length - 1], 100)
  assert.equal(p.from, 51)
  assert.equal(p.to, 100)
})

t('last, partial page: to is capped at total', () => {
  const p = paginate(seq(340), 6, 50) // 7th page → rows 301..340
  assert.equal(p.items.length, 40)
  assert.equal(p.from, 301)
  assert.equal(p.to, 340)
})

t('out-of-range page clamps to the last valid page (no blank table)', () => {
  const p = paginate(seq(120), 99, 50) // asked for page 100, only 3 pages exist
  assert.equal(p.page, 2)
  assert.equal(p.from, 101)
  assert.equal(p.to, 120)
  assert.equal(p.items.length, 20)
})

t('negative / NaN page resolves to the first page', () => {
  assert.equal(paginate(seq(10), -5, 25).page, 0)
  assert.equal(paginate(seq(10), NaN, 25).page, 0)
})

t('empty set: one page, zero from/to, no rows', () => {
  const p = paginate([], 0, 50)
  assert.deepEqual(p.items, [])
  assert.equal(p.total, 0)
  assert.equal(p.pageCount, 1)
  assert.equal(p.from, 0)
  assert.equal(p.to, 0)
})

t('single row: from and to both 1', () => {
  const p = paginate(seq(1), 0, 25)
  assert.equal(p.from, 1)
  assert.equal(p.to, 1)
  assert.equal(p.pageCount, 1)
})

t('page size change keeps rows in range (page recomputed by caller)', () => {
  // 250 rows, was on page 4 at size 25 (rows 101..125); switching to size 100 → page 4 clamps to 2.
  const p = paginate(seq(250), 4, 100)
  assert.equal(p.pageCount, 3)
  assert.equal(p.page, 2)
  assert.equal(p.from, 201)
  assert.equal(p.to, 250)
})

t('invalid page size falls back to a size of 1', () => {
  const p = paginate(seq(3), 0, 0)
  assert.equal(p.pageSize, 1)
  assert.equal(p.pageCount, 3)
  assert.deepEqual(p.items, [1])
})

t('order is preserved (no re-sorting)', () => {
  const p = paginate([9, 3, 7, 1, 5], 0, 3)
  assert.deepEqual(p.items, [9, 3, 7])
})

console.log(`\nAll ${passed} assertions passed.`)
