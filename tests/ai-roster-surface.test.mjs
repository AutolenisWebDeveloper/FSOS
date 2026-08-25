// FSOS-050 — the AI roster must not overstate the live surface. Each roster key carries a
// runtime SURFACE classification verified against actual callers. This proves the classification
// is truthful and, in particular, that the Phase-1 census corrections hold: executive_intelligence
// and pipeline are ACTIVE (not dead), and only the genuinely-unwired keys are 'roadmap'.
// Run: node tests/ai-roster-surface.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-roster-'))
execSync(
  `npx tsc src/lib/ai/roster.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { AGENT_ROSTER, AGENT_SURFACE, agentSurface } = require(join(out, 'roster.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('every roster key has a surface classification (no silent gaps)', () => {
  for (const key of Object.keys(AGENT_ROSTER)) {
    assert.ok(AGENT_SURFACE[key], `roster key "${key}" is missing a surface classification`)
  }
})

t('Phase-1 correction: executive_intelligence and pipeline are ACTIVE (not dead)', () => {
  assert.equal(agentSurface('executive_intelligence'), 'active')
  assert.equal(agentSurface('pipeline'), 'active')
})

t('the genuinely-unwired keys are classified roadmap (not presented as live)', () => {
  for (const k of ['agency_growth', 'case_management', 'document_intelligence']) {
    assert.equal(agentSurface(k), 'roadmap', `${k} should be roadmap`)
  }
})

t('routing/taxonomy-only keys are not presented as live agents', () => {
  assert.equal(agentSurface('agency_activation'), 'routing_label')
  assert.equal(agentSurface('referral_triage'), 'routing_label')
})

t('detection-job keys are labeled as jobs, not gateway agents', () => {
  assert.equal(agentSurface('data_quality'), 'detection_job')
  assert.equal(agentSurface('commission_reconciliation'), 'detection_job')
})

t('life_winback is wired but disabled-by-default (kill switch)', () => {
  assert.equal(agentSurface('life_winback'), 'disabled_by_default')
})

t('an unknown key defaults to roadmap (never falsely "active")', () => {
  assert.equal(agentSurface('does_not_exist'), 'roadmap')
})

// The live surface is a strict subset of the roster — the whole point of FSOS-050.
t('fewer keys are "active" than the total roster (no over-statement)', () => {
  const total = Object.keys(AGENT_ROSTER).length
  const active = Object.values(AGENT_SURFACE).filter((s) => s === 'active').length
  assert.ok(active < total, 'active agents must be a strict subset of the roster')
  assert.ok(active >= 8, `expected the known-live agents to be classified active, got ${active}`)
})

console.log(`\nAll ${passed} assertions passed.`)
