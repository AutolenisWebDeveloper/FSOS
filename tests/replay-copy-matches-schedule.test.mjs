// Follow-up R17e: the engine controls' replay help said the touch goes out at "the campaign's next
// daily run". The Life Conversion, Win-Back and district-nurture ticks run hourly 17:00–23:00 UTC
// (vercel.json), so the copy must name that window. Pinned to vercel.json so the two cannot drift.
// Run: node tests/replay-copy-matches-schedule.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
const ui = readFileSync('src/components/app/CampaignEngineControls.tsx', 'utf8')
let passed = 0
const failed = []
const t = (name, fn) => { try { fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('Replay copy matches the tick schedule')

t('the engines that render these controls tick hourly 17:00–23:00 UTC', () => {
  for (const p of ['/api/cron/life-conversion-tick', '/api/cron/pipeline-winback-tick', '/api/cron/district-nurture-tick']) {
    assert.equal(vercel.crons.find((c) => c.path === p)?.schedule, '0 17-23 * * *', p)
  }
})
t('the replay help names that window, not a daily run', () => {
  const line = ui.split('\n').find((l) => l.includes("value: 'replay'"))
  assert.ok(line, 'replay option present')
  assert.doesNotMatch(line, /daily run/)
  assert.match(line, /hourly, 17:00–23:00 UTC/)
})

if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
