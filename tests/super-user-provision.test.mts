// Super · user-provisioning proof (offline, no live Supabase).
// Proves the two pure cores the create-user flow depends on:
//   • UserCreateSchema — a super_admin's create payload is validated: email is
//     required + normalized, roles must be a non-empty subset of the fixed RBAC set,
//     securities_scope defaults false. Bad payloads are rejected at the edge.
//   • reconcileRoles — the JWT-claim ⇄ user_roles-table sync diff (prune + upsert) is
//     correct and deduped, so a provisioned user's roles land in both sources.
// Runs under tsx (the runner invokes `npx tsx` for .mts) so it imports the TS source
// directly — no fragile standalone tsc invocation.
// Run: npx tsx tests/super-user-provision.test.mts
import assert from 'node:assert/strict'
import { UserCreateSchema } from '../src/lib/validation/schemas'
import { reconcileRoles } from '../src/lib/services/user-roles'

const results: { pass: boolean; name: string; evidence: string }[] = []
function check(name: string, fn: () => void, evidence: () => string) {
  try {
    fn()
    results.push({ pass: true, name, evidence: evidence() })
  } catch (e) {
    results.push({ pass: false, name, evidence: e instanceof Error ? e.message : String(e) })
  }
}

// 1 — Valid payload: email normalized, securities_scope defaults false.
check(
  'UserCreateSchema accepts a valid payload and normalizes email + defaults scope',
  () => {
    const parsed = UserCreateSchema.safeParse({ email: '  New.User@Example.COM ', roles: ['fsa'] })
    assert.ok(parsed.success, 'should parse')
    assert.equal(parsed.data.email, 'new.user@example.com', 'email trimmed + lowercased')
    assert.deepEqual(parsed.data.roles, ['fsa'])
    assert.equal(parsed.data.securities_scope, false, 'defaults to false')
  },
  () => 'valid create payload parses; email normalized; scope defaults false',
)

// 2 — securities_scope passes through when provided.
check(
  'UserCreateSchema preserves securities_scope when set',
  () => {
    const parsed = UserCreateSchema.safeParse({ email: 'a@b.co', roles: ['super_admin'], securities_scope: true })
    assert.ok(parsed.success)
    assert.equal(parsed.data.securities_scope, true)
  },
  () => 'securities_scope:true survives parsing',
)

// 3 — Empty roles rejected (a user with no role can reach no portal).
check(
  'UserCreateSchema rejects an empty role set',
  () => {
    assert.equal(UserCreateSchema.safeParse({ email: 'a@b.co', roles: [] }).success, false)
  },
  () => 'roles:[] is rejected',
)

// 4 — Unknown role rejected (only the fixed RBAC set is grantable).
check(
  'UserCreateSchema rejects an unknown role',
  () => {
    assert.equal(UserCreateSchema.safeParse({ email: 'a@b.co', roles: ['wizard'] }).success, false)
  },
  () => "roles:['wizard'] is rejected",
)

// 5 — Invalid / empty email rejected.
check(
  'UserCreateSchema rejects an invalid email',
  () => {
    assert.equal(UserCreateSchema.safeParse({ email: 'not-an-email', roles: ['fsa'] }).success, false)
    assert.equal(UserCreateSchema.safeParse({ email: '', roles: ['fsa'] }).success, false)
  },
  () => 'malformed / empty email is rejected',
)

// 6 — reconcileRoles: fresh user gets the full set, nothing stale.
check(
  'reconcileRoles: new user → upsert all, prune none',
  () => {
    const r = reconcileRoles([], ['fsa', 'licensed_staff'])
    assert.deepEqual(r.stale, [])
    assert.deepEqual(r.toUpsert, ['fsa', 'licensed_staff'])
  },
  () => 'current [] → stale [], toUpsert [fsa, licensed_staff]',
)

// 7 — reconcileRoles: replacing a set prunes what is no longer granted.
check(
  'reconcileRoles: prunes roles no longer granted',
  () => {
    const r = reconcileRoles(['fsa', 'client'], ['fsa', 'admin'])
    assert.deepEqual(r.stale, ['client'])
    assert.deepEqual(r.toUpsert, ['fsa', 'admin'])
  },
  () => 'current [fsa,client] vs [fsa,admin] → stale [client], upsert [fsa,admin]',
)

// 8 — reconcileRoles: dedupes both sides deterministically.
check(
  'reconcileRoles: dedupes inputs',
  () => {
    const r = reconcileRoles(['fsa', 'fsa', 'ops'], ['admin', 'admin'])
    assert.deepEqual(r.toUpsert, ['admin'])
    assert.deepEqual(r.stale, ['fsa', 'ops'])
  },
  () => 'duplicate inputs collapse; order stable',
)

let failed = 0
for (const r of results) {
  process.stdout.write(`${r.pass ? '✓' : '✗'} ${r.name}\n    ${r.evidence}\n`)
  if (!r.pass) failed++
}
if (failed) {
  console.error(`\n✗ ${failed}/${results.length} checks failed.`)
  process.exit(1)
}
console.log(`\n✓ All ${results.length} super-user-provision checks passed.`)
