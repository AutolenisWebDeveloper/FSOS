// WS-047 (Batch 1, D-5 approval-gate integrity): 'compliance_approved' is minted ONLY by
// the /approve route, which records approver + snapshot (FINRA 2210). A bare PATCH status
// flip must be rejected BEFORE any write. EXECUTED against the real route handler (bundled
// with an auth stub; the recording db proves no workshops write happened).
// Run: node tests/workshop-status-integrity.test.mjs
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, fakeDb, installDb, makeReq } from './helpers/workshop-harness.mjs'

let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

// Auth stub: an authenticated FSA session (authz itself is proven by the real helpers'
// own tests; this file proves the STATUS-INTEGRITY guard behind the auth wall).
const stubDir = mkdtempSync(join(tmpdir(), 'fsos-auth-stub-'))
process.on('exit', () => { try { rmSync(stubDir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const authStub = join(stubDir, 'auth-stub.mjs')
writeFileSync(authStub, `
const session = { userId: 'u-test', roles: ['fsa'], email: 'fsa@test.example' }
export async function requireApiRole() { return { ok: true, session } }
export function requirePermission() { return null }
export function actorOf() { return 'fsa:u-test' }
`)

const route = await bundle('src/app/api/workshops/[id]/route.ts', { aliases: { '@/lib/auth/api': authStub } })
const props = { params: Promise.resolve({ id: 'aaaa1111-1111-1111-1111-111111111111' }) }

console.log('PATCH /api/workshops/[id] — compliance_approved cannot be minted by a bare status flip')
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: 'aaaa1111-1111-1111-1111-111111111111', status: 'pending_review', compliance_approval_ref: null, disclosure_config_id: null }],
  }))
  const res = await route.PATCH(makeReq('/api/workshops/x', { method: 'PATCH', body: { status: 'compliance_approved' } }), props)
  installDb(null)
  const body = await res.json()
  ok('bare PATCH to compliance_approved → 422', res.status === 422, JSON.stringify(body))
  ok('the rejection names the approval workflow', /approval workflow/i.test(String(body.error)))
  ok('NO workshops write happened', !db.calls.some((c) => c.table === 'workshops' && (c.method === 'update' || c.method === 'insert')))
}

console.log('Sanity: an ordinary detail PATCH still writes (the guard is surgical)')
{
  const db = installDb(fakeDb({
    workshops: [
      { workshop_id: 'aaaa1111-1111-1111-1111-111111111111', status: 'draft', compliance_approval_ref: null, disclosure_config_id: null },
      [{ workshop_id: 'aaaa1111-1111-1111-1111-111111111111', status: 'draft' }],
    ],
  }))
  const res = await route.PATCH(makeReq('/api/workshops/x', { method: 'PATCH', body: { title: 'Renamed Workshop' } }), props)
  installDb(null)
  ok('a plain title PATCH still succeeds', res.status === 200)
  const upd = db.calls.find((c) => c.table === 'workshops' && c.method === 'update')
  ok('and performs the workshops update', !!upd && upd.payload.title === 'Renamed Workshop')
}

console.log(`\n${passed} checks passed.`)
