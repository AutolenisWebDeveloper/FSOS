// Social → CRM attribution aggregation (ADR-026, operational depth item 3).
//
// Compiles the PURE aggregator and asserts it turns raw social_engagement links into
// entity-level attribution: distinct contacts/opportunities/tasks touched, resolved vs
// unresolved counts, and posts ranked by the CRM outcomes they drove — all from the
// links ingestion already creates (no new attribution model).

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-attr-'))
execSync(
  `npx tsc src/lib/social/attribution-agg.ts src/lib/social/adapters/index.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const { aggregateAttribution } = require(join(out, 'lib/social/attribution-agg.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const rows = [
  // Post A drove two different contacts, one became an opportunity.
  { id: '1', platform: 'facebook_page', post_ref: 'A', resolved_contact_id: 'c1', resolution_status: 'matched', classification: 'lead', linked_opportunity_id: null, linked_task_id: null, received_at: '2026-02-01' },
  { id: '2', platform: 'facebook_page', post_ref: 'A', resolved_contact_id: 'c2', resolution_status: 'triaged', classification: null, linked_opportunity_id: 'o1', linked_task_id: 't1', received_at: '2026-02-02' },
  // Post B: one touch, unresolved (no contact).
  { id: '3', platform: 'youtube', post_ref: 'B', resolved_contact_id: null, resolution_status: 'unmatched', classification: null, linked_opportunity_id: null, linked_task_id: null, received_at: '2026-02-03' },
  // A DM (no post) resolved to an existing contact c1 again (same contact, distinct touch).
  { id: '4', platform: 'facebook_page', post_ref: null, resolved_contact_id: 'c1', resolution_status: 'matched', classification: null, linked_opportunity_id: null, linked_task_id: null, received_at: '2026-02-04' },
]

t('summary counts distinct contacts/opportunities/tasks and resolved vs unresolved', () => {
  const r = aggregateAttribution(rows)
  assert.equal(r.summary.totalEngagements, 4)
  assert.equal(r.summary.resolved, 3) // rows 1,2,4 are matched/triaged
  assert.equal(r.summary.unresolved, 1)
  assert.equal(r.summary.contactsTouched, 2) // c1, c2 (c1 counted once)
  assert.equal(r.summary.opportunities, 1)
  assert.equal(r.summary.tasks, 1)
  assert.equal(r.summary.leads, 1)
})

t('attributed ids are DISTINCT (resolve to existing entities, no duplicates)', () => {
  const r = aggregateAttribution(rows)
  assert.deepEqual([...r.attributedContactIds].sort(), ['c1', 'c2'])
  assert.deepEqual(r.attributedOpportunityIds, ['o1'])
})

t('posts are ranked by the CRM outcomes they drove; post A leads', () => {
  const r = aggregateAttribution(rows)
  assert.equal(r.byPost[0].post_ref, 'A')
  assert.equal(r.byPost[0].resolvedContacts, 2)
  assert.equal(r.byPost[0].opportunities, 1)
  // the null-post DM buckets separately and does not merge into post A
  assert.ok(r.byPost.some((p) => p.post_ref === null))
})

t('per-platform rollup counts distinct resolved contacts', () => {
  const r = aggregateAttribution(rows)
  const fb = r.byPlatform.find((p) => p.platform === 'facebook_page')
  assert.equal(fb.touches, 3)
  assert.equal(fb.resolvedContacts, 2) // c1, c2
})

t('empty input yields a zeroed summary, not a crash', () => {
  const r = aggregateAttribution([])
  assert.equal(r.summary.totalEngagements, 0)
  assert.equal(r.summary.contactsTouched, 0)
  assert.deepEqual(r.byPost, [])
})

console.log(`\nSocial Attribution: ${passed} assertions passed.`)
