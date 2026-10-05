// Follow-up R17d: "Active agents" on /app/ai counted every enabled ai_agents row, including the
// three workforce agents stood down because a campaign engine owns their audience (owner decision
// 7: cross_sell, term_conversion, life_winback). They never send, so they are not active.
// Run: node tests/ai-active-agents-count.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundle } from './helpers/workshop-harness.mjs'

const roster = await bundle('src/lib/ai/roster.ts')
let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('Active agents excludes stood-down agents')

const ROWS = [
  { key: 'referral_followup', enabled: true },
  { key: 'marketing_automation', enabled: true },
  { key: 'conversation', enabled: false },
  { key: 'cross_sell', enabled: true },
  { key: 'term_conversion', enabled: true },
  { key: 'life_winback', enabled: true },
]
await t('enabled stood-down agents are not counted active, and are reported separately', () => {
  assert.equal(typeof roster.activeAgentCount, 'function', 'activeAgentCount exists')
  assert.deepEqual(roster.activeAgentCount(ROWS), { active: 2, total: 3, stoodDown: 3 })
})
await t('the AI Operations page uses it', () => {
  const src = readFileSync('src/app/(fsa)/app/ai/page.tsx', 'utf8')
  assert.match(src, /activeAgentCount\(agents\.data\)/)
  assert.doesNotMatch(src, /agents\.data\.filter\(\(a\) => a\.enabled\)\.length/)
})

if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
