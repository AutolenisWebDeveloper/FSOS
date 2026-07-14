// Foundation gate — authorization test matrix (middleware-auth.md §8).
// Exercises the PURE access decision (evaluateAccess) that src/middleware.ts uses,
// so the portal/role/MFA gate is verified without a live Supabase or Next runtime.
// Run: node tests/auth-matrix.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-auth-'))
execSync(
  `npx tsc src/lib/auth/rbac.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
// Single-file compile → tsc roots at the file's dir, emitting OUT/rbac.js.
const { evaluateAccess, isPublicPath, portalOf } = require(join(out, 'rbac.js'))

const session = (roles, { mfa = true, stepUp = true } = {}) => ({
  userId: 'u1',
  roles,
  mfaSatisfied: mfa,
  stepUpFresh: stepUp,
})

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Authorization matrix (middleware-auth §8)')

t('permitted role loads a portal', () => {
  assert.equal(evaluateAccess('/app', session(['fsa'])).action, 'allow')
  assert.equal(evaluateAccess('/app/agencies', session(['licensed_staff'])).action, 'allow')
})

t('anonymous → redirect to /login', () => {
  const d = evaluateAccess('/app', null)
  assert.equal(d.action, 'redirect')
  assert.equal(d.reason, 'unauthenticated')
  assert.ok(d.to.startsWith('/login'))
})

t('wrong role → 403 (forbid)', () => {
  assert.equal(evaluateAccess('/app', session(['client'])).action, 'forbid')
  assert.equal(evaluateAccess('/compliance', session(['fsa'])).action, 'forbid')
})

t('no-MFA on an MFA-required portal → redirect to /login/mfa', () => {
  const d = evaluateAccess('/app', session(['fsa'], { mfa: false }))
  assert.equal(d.action, 'redirect')
  assert.equal(d.reason, 'mfa')
  assert.ok(d.to.startsWith('/login/mfa'))
})

t('super-only: non-super → 403', () => {
  assert.equal(evaluateAccess('/super', session(['admin'])).action, 'forbid')
  assert.equal(evaluateAccess('/super/users', session(['fsa'])).action, 'forbid')
})

t('super with fresh step-up → allow', () => {
  assert.equal(evaluateAccess('/super', session(['super_admin'], { mfa: true, stepUp: true })).action, 'allow')
})

t('super without MFA → mfa; with MFA but stale step-up → stepup', () => {
  assert.equal(evaluateAccess('/super', session(['super_admin'], { mfa: false })).reason, 'mfa')
  const d = evaluateAccess('/super', session(['super_admin'], { mfa: true, stepUp: false }))
  assert.equal(d.action, 'redirect')
  assert.equal(d.reason, 'stepup')
})

t('super_admin can reach every portal via the switcher', () => {
  for (const p of ['/app', '/admin', '/compliance']) {
    assert.equal(evaluateAccess(p, session(['super_admin'])).action, 'allow')
  }
})

t('partner/client MFA is optional (no MFA → still allowed)', () => {
  assert.equal(evaluateAccess('/partner', session(['agency_owner'], { mfa: false })).action, 'allow')
  assert.equal(evaluateAccess('/client', session(['client'], { mfa: false })).action, 'allow')
})

t('public allowlist is never gated', () => {
  assert.equal(evaluateAccess('/login', null).action, 'allow')
  assert.equal(evaluateAccess('/', null).action, 'allow')
  assert.equal(evaluateAccess('/refer', null).action, 'allow')
})

t('legacy public routes remain public (/[slug], /forms/*, /upload/*)', () => {
  assert.equal(isPublicPath('/some-agency-slug'), true)
  assert.equal(isPublicPath('/forms/abc123'), true)
  assert.equal(isPublicPath('/upload/xyz'), true)
  assert.equal(isPublicPath('/app'), false)
  assert.equal(isPublicPath('/app/agencies'), false)
})

t('portalOf maps prefixes correctly', () => {
  assert.equal(portalOf('/app/agencies'), 'fsa')
  assert.equal(portalOf('/admin/cases'), 'admin')
  assert.equal(portalOf('/super/users'), 'super')
  assert.equal(portalOf('/partner'), 'partner')
  assert.equal(portalOf('/refer'), 'public')
})

console.log(`\nAll ${passed} assertions passed.`)
