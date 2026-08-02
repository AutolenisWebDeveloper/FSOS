// Bulk template administration — proves the PURE authority matrix + state-transition
// plan offline (compile the TS core with tsc, then assert), mirroring the pattern in
// tests/comms-policy.test.mjs. Guardrail: authoring roles may NEVER approve/unapprove;
// only compliance/supervisor/super_admin may. Run: node tests/template-bulk.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-tplbulk-'))
// Prefer the project-pinned tsc (node_modules) — a globally-installed newer tsc rejects
// file args when a tsconfig is present (TS5112). Fall back to `npx tsc` for CI parity.
import { existsSync } from 'node:fs'
const localTsc = join(process.cwd(), 'node_modules', '.bin', 'tsc')
const tsc = existsSync(localTsc) ? `"${localTsc}"` : 'npx tsc'
execSync(
  `${tsc} src/lib/comms/template-admin.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { canBulkTemplateAction, bulkTemplatePlan, TEMPLATE_BULK_ACTIONS } = require(join(out, 'template-admin.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Bulk template authority matrix')

t('approve/unapprove require an approver role (compliance/supervisor/super_admin)', () => {
  for (const action of ['approve', 'unapprove']) {
    assert.equal(canBulkTemplateAction(action, ['compliance']).allowed, true, `compliance ${action}`)
    assert.equal(canBulkTemplateAction(action, ['supervisor']).allowed, true, `supervisor ${action}`)
    assert.equal(canBulkTemplateAction(action, ['super_admin']).allowed, true, `super ${action}`)
  }
})

t('an author (fsa/licensed_staff) may NOT approve or unapprove — separation of authority', () => {
  for (const action of ['approve', 'unapprove']) {
    const fsa = canBulkTemplateAction(action, ['fsa'])
    const staff = canBulkTemplateAction(action, ['licensed_staff'])
    assert.equal(fsa.allowed, false, `fsa must not ${action}`)
    assert.equal(fsa.reason, 'insufficient_permission')
    assert.equal(staff.allowed, false, `licensed_staff must not ${action}`)
  }
})

t('delete (archive) is allowed for template managers incl. authors, denied for outsiders', () => {
  for (const r of ['fsa', 'licensed_staff', 'super_admin', 'compliance', 'supervisor']) {
    assert.equal(canBulkTemplateAction('delete', [r]).allowed, true, `${r} may delete`)
  }
  assert.equal(canBulkTemplateAction('delete', ['client']).allowed, false, 'client may not delete')
  assert.equal(canBulkTemplateAction('delete', ['agency_owner']).allowed, false, 'partner may not delete')
})

t('no roles → every action denied (fail-closed)', () => {
  for (const action of TEMPLATE_BULK_ACTIONS) {
    assert.equal(canBulkTemplateAction(action, []).allowed, false, `empty roles must deny ${action}`)
  }
})

console.log('Bulk state-transition plan')

t('approve sets approved + stamps approver, skips already-approved rows', () => {
  const p = bulkTemplatePlan('approve', '2026-08-02T00:00:00.000Z', 'user-1')
  assert.equal(p.patch.approval_status, 'approved')
  assert.equal(p.patch.approved_at, '2026-08-02T00:00:00.000Z')
  assert.equal(p.patch.approved_by, 'user-1')
  assert.equal(p.excludeApproved, true)
  assert.equal(p.requireStatus, null)
  assert.equal(p.audit, 'approval.decided')
})

t('unapprove resets an approved row to draft and clears the approval stamp', () => {
  const p = bulkTemplatePlan('unapprove', '2026-08-02T00:00:00.000Z', 'user-1')
  assert.equal(p.patch.approval_status, 'draft')
  assert.equal(p.patch.approved_at, null)
  assert.equal(p.patch.approved_by, null)
  assert.equal(p.requireStatus, 'approved', 'only approved rows are eligible to unapprove')
  assert.equal(p.audit, 'approval.decided')
})

t('delete soft-deletes via archived_at (history preserved) and audits as entity.deleted', () => {
  const p = bulkTemplatePlan('delete', '2026-08-02T00:00:00.000Z', 'user-1')
  assert.equal(p.patch.archived_at, '2026-08-02T00:00:00.000Z')
  assert.equal(p.patch.approval_status, undefined, 'delete must not touch approval_status')
  assert.equal(p.audit, 'entity.deleted')
})

console.log(`\n✓ template-bulk: ${passed} assertions passed`)
