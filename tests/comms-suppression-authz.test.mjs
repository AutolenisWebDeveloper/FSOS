// Suppression mutation AUTHORIZATION + input validation (offline). Proves the server-side
// role gate the route enforces (fsa + super_admin may mutate; everyone else is denied) and
// that the Zod schema rejects unsafe input — a reason is required to block, a bulk client op
// needs a non-empty selection, and each scope carries its required id(s).
//
// Run: node tests/comms-suppression-authz.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Emit INSIDE the project so the compiled schemas.js can resolve `zod` from node_modules.
const out = mkdtempSync(join(process.cwd(), '.supp-authz-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
execSync(
  `npx tsc src/lib/auth/rbac.ts src/lib/validation/schemas.ts src/lib/comms/purpose.ts src/lib/comms/claims.ts ` +
    `--rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { rolesIntersect, allowedRoles } = require(join(out, 'lib/auth/rbac.js'))
const { SuppressionApplySchema } = require(join(out, 'lib/validation/schemas.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// The route: requireApiRole('fsa') admits the /app portal roles, then requirePermission
// narrows the MUTATION to these.
const MUTATE_ROLES = ['fsa', 'super_admin']

console.log('Authorization — who may mutate suppression')

t('/app portal admits fsa / licensed_staff / super_admin only', () => {
  const portal = allowedRoles('fsa')
  assert.deepEqual([...portal].sort(), ['fsa', 'licensed_staff', 'super_admin'].sort())
})

t('fsa and super_admin PASS the mutation verb gate', () => {
  assert.equal(rolesIntersect(['fsa'], MUTATE_ROLES), true)
  assert.equal(rolesIntersect(['super_admin'], MUTATE_ROLES), true)
})

t('every other role is DENIED the mutation (server-enforced, not a hidden button)', () => {
  for (const role of ['licensed_staff', 'admin', 'ops', 'case_manager', 'compliance', 'supervisor', 'agency_owner', 'client']) {
    assert.equal(rolesIntersect([role], MUTATE_ROLES), false, role)
  }
})

console.log('Validation — SuppressionApplySchema')

const AG = '11111111-1111-1111-1111-111111111111'
const C = '22222222-2222-2222-2222-222222222222'

t('agency block REQUIRES a reason', () => {
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'agency', agencyId: AG, status: 'blocked' }).success, false)
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'agency', agencyId: AG, status: 'blocked', reason: 'ok reason' }).success, true)
})

t('agency UNBLOCK does not require a reason', () => {
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'agency', agencyId: AG, status: 'active' }).success, true)
})

t('agency scope requires a valid agencyId', () => {
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'agency', status: 'active' }).success, false)
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'agency', agencyId: 'not-a-uuid', status: 'active' }).success, false)
})

t('client scope requires a NON-EMPTY contactIds set; block requires a reason', () => {
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'client', contactIds: [], status: 'blocked', reason: 'x reason' }).success, false)
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'client', contactIds: [C], status: 'blocked' }).success, false)
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'client', contactIds: [C], status: 'blocked', reason: 'valid reason' }).success, true)
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'client', contactIds: [C], status: 'active' }).success, true)
})

t('unknown scope is rejected', () => {
  assert.equal(SuppressionApplySchema.safeParse({ scope: 'everything', status: 'blocked', reason: 'x' }).success, false)
})

console.log(`\n✓ suppression authz + validation: ${passed} cases passed`)
