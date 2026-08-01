// Cross-Sell Life — operational-control route contract (A5).
// Compiles the PURE control contract (src/lib/cross-sell-life/control-contract.ts) in isolation —
// it imports only zod, no DB/Next — and asserts the two things the route's guard depends on:
//   1. the ROUTE-LEVEL AUTHZ gate: exactly the four control roles pass isAuthorizedForControl;
//      every other RBAC role (and an empty set) fails closed; a mixed set passes on intersection.
//   2. the INPUT CONTRACT: the accepted action set, the resume-strategy override enums (the A3
//      capability), reason bounds, and rejection of malformed bodies.
// This proves the gate the live route enforces (requirePermission(CONTROL_ROLES) + ControlInputSchema)
// without standing up the Next/Supabase middleware, mirroring auth-matrix.test.mjs.
// Run: node tests/cross-sell-life-control-contract.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// The contract imports zod, so the compiled output must sit INSIDE the repo tree — Node's module
// resolution then walks up from the emit dir to the repo's node_modules to find zod (an OS-tmpdir
// emit, as the dependency-free state tests use, cannot resolve it). Cleaned up after loading.
const out = mkdtempSync(join(process.cwd(), '.fsos-control-contract-test-'))
try {
  execSync(
    `npx tsc src/lib/cross-sell-life/control-contract.ts --outDir ${out} --module commonjs ` +
      `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
    { stdio: 'inherit' },
  )
} catch (e) {
  rmSync(out, { recursive: true, force: true })
  throw e
}
const require = createRequire(import.meta.url)
const {
  CONTROL_ACTIONS,
  RESUME_BEHAVIORS,
  REPLAY_POLICIES,
  CONTROL_ROLE_NAMES,
  ControlInputSchema,
  isAuthorizedForControl,
} = require(join(out, 'control-contract.js'))
rmSync(out, { recursive: true, force: true }) // module + zod are loaded into memory; scratch dir no longer needed

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Route-level authorization gate (§ Permissions)')

t('exactly the four control roles are authorized', () => {
  for (const r of ['admin', 'ops', 'super_admin', 'fsa']) {
    assert.equal(isAuthorizedForControl([r]), true, `${r} must be authorized`)
  }
  assert.deepEqual([...CONTROL_ROLE_NAMES].sort(), ['admin', 'fsa', 'ops', 'super_admin'])
})

t('every non-control RBAC role fails closed', () => {
  for (const r of ['licensed_staff', 'case_manager', 'compliance', 'supervisor', 'agency_owner', 'client']) {
    assert.equal(isAuthorizedForControl([r]), false, `${r} must NOT be authorized`)
  }
})

t('an empty or unknown role set fails closed', () => {
  assert.equal(isAuthorizedForControl([]), false)
  assert.equal(isAuthorizedForControl(['not_a_role']), false)
})

t('authorization is by intersection — one control role among others still passes', () => {
  assert.equal(isAuthorizedForControl(['client', 'fsa']), true)
  assert.equal(isAuthorizedForControl(['agency_owner', 'client']), false)
})

console.log('Input contract (ControlInputSchema)')

t('a minimal { action } body is valid for every control action', () => {
  assert.equal(CONTROL_ACTIONS.length, 7)
  for (const action of CONTROL_ACTIONS) {
    assert.equal(ControlInputSchema.safeParse({ action }).success, true, `${action} should parse`)
  }
})

t('action is required and must be a known control action', () => {
  assert.equal(ControlInputSchema.safeParse({}).success, false)
  assert.equal(ControlInputSchema.safeParse({ action: 'delete' }).success, false)
  assert.equal(ControlInputSchema.safeParse({ action: '' }).success, false)
})

t('resume-strategy overrides (A3) accept only the known behavior/replay enums', () => {
  assert.equal(RESUME_BEHAVIORS.length, 4)
  assert.equal(REPLAY_POLICIES.length, 2)
  for (const resumeBehavior of RESUME_BEHAVIORS) {
    assert.equal(ControlInputSchema.safeParse({ action: 'resume', resumeBehavior }).success, true, `${resumeBehavior} ok`)
  }
  for (const replayPolicy of REPLAY_POLICIES) {
    assert.equal(ControlInputSchema.safeParse({ action: 'resume', replayPolicy }).success, true, `${replayPolicy} ok`)
  }
  assert.equal(ControlInputSchema.safeParse({ action: 'resume', resumeBehavior: 'bogus' }).success, false)
  assert.equal(ControlInputSchema.safeParse({ action: 'resume', replayPolicy: 'later' }).success, false)
})

t('resume strategy is optional — a bare resume is valid', () => {
  assert.equal(ControlInputSchema.safeParse({ action: 'resume' }).success, true)
})

t('reason is optional, trimmed, and capped at 300 chars', () => {
  assert.equal(ControlInputSchema.safeParse({ action: 'pause', reason: 'seasonal hold' }).success, true)
  const parsed = ControlInputSchema.safeParse({ action: 'pause', reason: '  spaced  ' })
  assert.equal(parsed.success, true)
  assert.equal(parsed.data.reason, 'spaced')
  assert.equal(ControlInputSchema.safeParse({ action: 'pause', reason: 'x'.repeat(301) }).success, false)
})

t('unknown fields are stripped, not rejected (forward-compatible body)', () => {
  const parsed = ControlInputSchema.safeParse({ action: 'enable', surprise: true })
  assert.equal(parsed.success, true)
  assert.equal('surprise' in parsed.data, false)
})

console.log(`\nAll ${passed} assertions passed.`)
