// FSOS-060 — API mutations must enforce the portal's MFA / step-up requirement (the Next
// middleware matcher excludes /api/*). requireApiRole now applies the same mfaLevel(portal)
// decision as page navigation. This bundles the REAL requireApiRole with the session provider
// stubbed to a canned session, and asserts the full negative-security matrix. No server.
// Run: node tests/api-auth-stepup.test.mjs
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = process.cwd()
const dir = mkdtempSync(join(tmpdir(), 'fsos-api-stepup-'))
const write = (n, b) => { const p = join(dir, n); writeFileSync(p, b); return p }

const SESSION_STUB = `module.exports = { getServerSession: async () => globalThis.__SESSION__ ?? null }`
const NEXT_STUB = `module.exports = { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { status: (init && init.status) || 200 }) } }`
const sessionStub = write('session.js', SESSION_STUB)
const nextStub = write('next-server.js', NEXT_STUB)

const entry = write('entry.ts', `export { requireApiRole } from '@/lib/auth/api'\n`)
const out = join(dir, 'bundle.cjs')
await build({
  entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs',
  target: 'node20', logLevel: 'silent',
  plugins: [{
    name: 'sub', setup(b) {
      b.onResolve({ filter: /^next\/server$/ }, () => ({ path: nextStub }))
      b.onResolve({ filter: /(^\.\/session$)|(auth\/session$)/ }, () => ({ path: sessionStub }))
      b.onResolve({ filter: /^@\// }, (a) => ({ path: resolve(ROOT, 'src', a.path.slice(2)) + (/\.[a-z]+$/.test(a.path) ? '' : '.ts') }))
    },
  }],
})
const require = createRequire(import.meta.url)
const { requireApiRole } = require(out)

const S = (roles, mfaSatisfied, stepUpFresh) => ({ userId: 'u1', roles, mfaSatisfied, stepUpFresh })
let passed = 0
const t = (name, fn) => fn().then(() => { passed++; console.log('  ✓', name) })

const run = async () => {
  await t('unauthenticated → 401', async () => {
    globalThis.__SESSION__ = null
    const r = await requireApiRole('fsa')
    assert.equal(r.ok, false); assert.equal(r.response.status, 401)
  })
  await t('wrong role for portal → 403', async () => {
    globalThis.__SESSION__ = S(['client'], true, true)
    const r = await requireApiRole('fsa')
    assert.equal(r.ok, false); assert.equal(r.response.status, 403)
  })
  await t('correct role but aal1 (no MFA) on a required portal → 403 mfa_required', async () => {
    globalThis.__SESSION__ = S(['fsa'], false, false)
    const r = await requireApiRole('fsa')
    assert.equal(r.ok, false); assert.equal(r.response.status, 403)
    assert.equal((await r.response.json()).reason, 'mfa_required')
  })
  await t('super role, aal2, but STALE step-up on /super → 403 stepup_required', async () => {
    globalThis.__SESSION__ = S(['super_admin'], true, false)
    const r = await requireApiRole('super')
    assert.equal(r.ok, false); assert.equal(r.response.status, 403)
    assert.equal((await r.response.json()).reason, 'stepup_required')
  })
  await t('authorized happy path: fsa + aal2 on required portal → ok', async () => {
    globalThis.__SESSION__ = S(['fsa'], true, true)
    const r = await requireApiRole('fsa')
    assert.equal(r.ok, true); assert.deepEqual(r.session.roles, ['fsa'])
  })
  await t('authorized happy path: super_admin + fresh step-up on /super → ok', async () => {
    globalThis.__SESSION__ = S(['super_admin'], true, true)
    const r = await requireApiRole('super')
    assert.equal(r.ok, true)
  })
  await t('optional-MFA portal (partner) allows aal1 (no step-up required there)', async () => {
    globalThis.__SESSION__ = S(['agency_owner'], false, false)
    const r = await requireApiRole('partner')
    assert.equal(r.ok, true)
  })
  console.log(`\nAll ${passed} assertions passed.`)
}
run().catch((e) => { console.error('\nFAIL:', e && e.stack ? e.stack : e); process.exit(1) })
