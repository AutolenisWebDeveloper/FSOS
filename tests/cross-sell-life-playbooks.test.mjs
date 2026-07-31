// Cross-Sell Life Campaign — AI playbooks (§9) + advisor scripts (§10) mapping proof. Compiles the
// two PURE data modules (src/lib/cross-sell-life/{playbooks,advisor-scripts}.ts) in isolation (no
// Supabase) and asserts each library has the exact size the frozen §6 schedule requires and that
// every entry maps to its scheduled touch number — so the seed content can never drift out of
// alignment with the 7 AI-conversation touches and 4 advisor-outreach touches.
// Run: node tests/cross-sell-life-playbooks.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-xsell-playbooks-'))
execSync(
  `npx tsc src/lib/cross-sell-life/playbooks.ts src/lib/cross-sell-life/advisor-scripts.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { PLAYBOOKS, playbookForTouch } = require(join(out, 'playbooks.js'))
const { ADVISOR_SCRIPTS, advisorScriptForTouch } = require(join(out, 'advisor-scripts.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// The 7 AI-conversation touches and 4 advisor-outreach touches from the frozen §6 schedule.
const AI_TOUCHES = [3, 9, 13, 18, 23, 29, 35]
const ADVISOR_TOUCHES = [6, 16, 26, 32]

console.log('AI playbooks (§9)')

t('there are exactly 7 playbooks — one per AI-conversation touch', () => {
  assert.equal(PLAYBOOKS.length, 7)
})

t('the playbook touch_no set is exactly {3,9,13,18,23,29,35}', () => {
  assert.deepEqual([...PLAYBOOKS.map((p) => p.touch_no)].sort((a, b) => a - b), AI_TOUCHES)
})

t('playbookForTouch returns the matching playbook for every AI touch', () => {
  for (const n of AI_TOUCHES) {
    const p = playbookForTouch(n)
    assert.ok(p, `expected a playbook for touch ${n}`)
    assert.equal(p.touch_no, n)
  }
})

t('playbookForTouch(n) is null for a non-AI touch', () => {
  assert.equal(playbookForTouch(1), null)
  assert.equal(playbookForTouch(6), null) // an advisor touch, not an AI touch
})

t('every playbook key is distinct', () => {
  const keys = PLAYBOOKS.map((p) => p.key)
  assert.equal(new Set(keys).size, keys.length)
})

console.log('Advisor scripts (§10)')

t('there are exactly 4 advisor scripts — one per advisor-outreach touch', () => {
  assert.equal(ADVISOR_SCRIPTS.length, 4)
})

t('the advisor-script touch_no set is exactly {6,16,26,32}', () => {
  assert.deepEqual([...ADVISOR_SCRIPTS.map((s) => s.touch_no)].sort((a, b) => a - b), ADVISOR_TOUCHES)
})

t('advisorScriptForTouch returns the matching script for every advisor touch', () => {
  for (const n of ADVISOR_TOUCHES) {
    const s = advisorScriptForTouch(n)
    assert.ok(s, `expected a script for touch ${n}`)
    assert.equal(s.touch_no, n)
  }
})

t('advisorScriptForTouch(n) is null for a non-advisor touch', () => {
  assert.equal(advisorScriptForTouch(3), null) // an AI touch
  assert.equal(advisorScriptForTouch(1), null)
})

console.log(`\nAll ${passed} assertions passed.`)
