// Regression harness for the provider-neutral pipeline/stage taxonomy
// (src/lib/pipelines.ts) relocated during the GHL excision. Proves the FSOS-native
// business semantics were preserved: stage lookups, positional resolution, the
// application-submitted / issued lifecycle markers, and the read-model summary
// (which resolves a stored stage id, historically a ghl_* column, to a display shape).
// Run: node tests/pipelines-taxonomy.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-test-'))
execSync(
  `npx tsc src/lib/pipelines.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  PIPELINES,
  findStageById,
  findPipelineById,
  stageAt,
  isApplicationSubmittedStage,
  isIssuedStage,
  pipelineSummary,
} = require(join(out, 'pipelines.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Pipeline catalog')
t('three pipelines with the canonical keys', () => {
  assert.deepEqual(
    PIPELINES.map((p) => p.key),
    ['prospect_client', 'agency_owner', 'term_conversions'],
  )
})
t('internal-pipeline mapping preserved', () => {
  const byKey = Object.fromEntries(PIPELINES.map((p) => [p.key, p.internal]))
  assert.equal(byKey.prospect_client, 'general')
  assert.equal(byKey.agency_owner, 'owner')
  assert.equal(byKey.term_conversions, 'conversions')
})

console.log('Stage lookups')
t('findStageById resolves a known stage to its pipeline', () => {
  const loc = findStageById('f7be8411-c27e-4d67-9a73-5f4b048425ee')
  assert.equal(loc.stageName, 'Application Submitted')
  assert.equal(loc.position, 7)
  assert.equal(loc.pipeline.key, 'prospect_client')
})
t('findStageById returns null for unknown / empty', () => {
  assert.equal(findStageById('nope'), null)
  assert.equal(findStageById(null), null)
})
t('findPipelineById resolves by pipeline id', () => {
  assert.equal(findPipelineById('nuOBjRl27uhinHChdqfH').key, 'prospect_client')
  assert.equal(findPipelineById('missing'), null)
})
t('stageAt resolves by key + 1-based position', () => {
  assert.equal(stageAt('prospect_client', 1).name, 'New Opportunity')
  assert.equal(stageAt('term_conversions', 6).name, 'Converted (Issued)')
  assert.equal(stageAt('prospect_client', 99), null)
})

console.log('Lifecycle markers')
t('isApplicationSubmittedStage covers both pipelines A & C submit stages', () => {
  assert.equal(isApplicationSubmittedStage('f7be8411-c27e-4d67-9a73-5f4b048425ee'), true)
  assert.equal(isApplicationSubmittedStage('971271bb-8710-4a49-8e0d-f66cd6b899d5'), true)
  assert.equal(isApplicationSubmittedStage('8681cb03-c6d6-4803-8227-2ac4802f4bf4'), false)
})
t('isIssuedStage covers both pipelines A & C issued stages', () => {
  assert.equal(isIssuedStage('663763b9-b082-47d8-8c82-67342d49a823'), true)
  assert.equal(isIssuedStage('c718945e-f219-4b71-aae4-02b0d513f489'), true)
  assert.equal(isIssuedStage('nope'), false)
})

console.log('Read-model summary')
t('pipelineSummary resolves a stored stage id to the display shape', () => {
  const s = pipelineSummary({ ghl_stage_id: 'f7be8411-c27e-4d67-9a73-5f4b048425ee', ghl_opportunity_id: 'opp-1' })
  assert.equal(s.stage, 'Application Submitted')
  assert.equal(s.stage_position, 7)
  assert.equal(s.pipeline, 'Prospect / Client')
  assert.equal(s.pipeline_key, 'prospect_client')
  assert.equal(s.opportunity_id, 'opp-1')
  assert.equal(s.in_ghl, true)
})
t('pipelineSummary degrades cleanly when nothing is stored (dormant read → empty)', () => {
  const s = pipelineSummary({})
  assert.equal(s.stage, null)
  assert.equal(s.pipeline, null)
  assert.equal(s.in_ghl, false)
  const n = pipelineSummary(null)
  assert.equal(n.in_ghl, false)
})
t('pipelineSummary marks presence from a contact id without a stage', () => {
  const s = pipelineSummary({ ghl_contact_id: 'c-1' })
  assert.equal(s.in_ghl, true)
  assert.equal(s.stage, null)
})

console.log(`\nAll ${passed} assertions passed.`)
