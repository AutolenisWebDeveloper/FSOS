// Global Search sanitize() — the LIKE-injection escape boundary for the FSA
// global search (redesign spec §11). Verifies LIKE metacharacters (% _ \) are
// escaped, PostgREST/or() metacharacters are stripped, and the digit extraction
// used for phone/number matching is correct. Run: node tests/global-search-sanitize.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-search-'))
execSync(
  `npx tsc src/lib/search/sanitize.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { sanitize } = require(join(out, 'sanitize.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('plain term wraps in % and yields no digits', () => {
  const s = sanitize('Smith')
  assert.equal(s.like, '%Smith%')
  assert.equal(s.digits, '')
})

t('LIKE wildcards are escaped so they match literally', () => {
  const s = sanitize('50%_off')
  assert.ok(s.like.includes('50\\%'), 'percent escaped')
  assert.ok(s.like.includes('\\_off'), 'underscore escaped')
})

t('backslash is escaped', () => {
  const s = sanitize('a\\b')
  assert.ok(s.like.includes('a\\\\b'))
})

t('or()/PostgREST metacharacters are stripped', () => {
  const s = sanitize('a,b(c)*d')
  for (const ch of [',', '(', ')', '*']) assert.ok(!s.like.includes(ch), `stripped ${ch}`)
})

t('digits are extracted for phone/number matching', () => {
  assert.equal(sanitize('(469) 555-0102').digits, '4695550102')
  assert.equal(sanitize('POL-000123').digits, '000123')
})

t('empty / whitespace-only → null', () => {
  assert.equal(sanitize('   '), null)
  assert.equal(sanitize(''), null)
})

console.log(`\nAll ${passed} assertions passed.`)
