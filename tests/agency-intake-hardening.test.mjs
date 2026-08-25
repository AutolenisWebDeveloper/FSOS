// FSOS-062 — the PUBLIC, unauthenticated, service-role intake routes (/api/agencies/upload and
// /api/agencies/referral) must carry abuse controls (parity with /api/public/refer): a per-IP
// rate limit, a honeypot that writes NOTHING, and an audit trail. This bundles the REAL route
// handlers (esbuild) with an in-memory spy DB (records every insert) and drives them with real
// Requests. No Postgres needed — the assertion is on the route's control flow, not schema.
// Run: node tests/agency-intake-hardening.test.mjs
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = process.cwd()
const dir = mkdtempSync(join(tmpdir(), 'fsos-agency-intake-'))

// Substitute exactly the boundaries: the DB (in-memory spy), audit (spy), forms (no-op).
const CLIENT_STUB = `
module.exports = {
  getDb() { return globalThis.__SPY_DB__ },
  getBrowserDb() { throw new Error('no browser client') },
  ConfigError: class ConfigError extends Error {},
}`
const AUDIT_STUB = `module.exports = { writeAudit: async (e) => { (globalThis.__AUDITS__ ||= []).push(e) } }`
const FORMS_STUB = `module.exports = { sendForm: async () => ({ ok: true }) }`
// Minimal next/server so the route's NextResponse.json returns a real Response we can assert on.
const NEXT_STUB = `
module.exports = {
  NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { status: (init && init.status) || 200, headers: { 'content-type': 'application/json' } }) },
  NextRequest: globalThis.Request,
}`

const stub = (name, body) => { const p = join(dir, name); writeFileSync(p, body); return p }
const clientStub = stub('client.js', CLIENT_STUB)
const auditStub = stub('audit.js', AUDIT_STUB)
const formsStub = stub('forms.js', FORMS_STUB)
const nextStub = stub('next-server.js', NEXT_STUB)

const entry = join(dir, 'entry.ts')
writeFileSync(
  entry,
  `export { POST as uploadPOST } from '@/app/api/agencies/upload/route'\n` +
    `export { POST as referralPOST } from '@/app/api/agencies/referral/route'\n`,
)
const out = join(dir, 'bundle.cjs')
await build({
  entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs',
  target: 'node20', logLevel: 'silent', external: ['react', 'react-dom'],
  plugins: [{
    name: 'sub', setup(b) {
      b.onResolve({ filter: /^next\/server$/ }, () => ({ path: nextStub }))
      b.onResolve({ filter: /(^|\/)supabase\/client$/ }, () => ({ path: clientStub }))
      b.onResolve({ filter: /(^|\/)audit\/log$/ }, () => ({ path: auditStub }))
      b.onResolve({ filter: /(^|\/)lib\/forms$/ }, () => ({ path: formsStub }))
      b.onResolve({ filter: /^@\// }, (a) => ({ path: resolve(ROOT, 'src', a.path.slice(2)) + (/\.[a-z]+$/.test(a.path) ? '' : '.ts') }))
    },
  }],
})
const require = createRequire(import.meta.url)
const { uploadPOST, referralPOST } = require(out)

// ── in-memory spy DB: a thenable chainable builder that records every insert ──────
function makeSpyDb() {
  const inserts = []
  function builder(table) {
    const b = {
      _canned: undefined,
      select() { return b },
      eq() { return b },
      is() { return b },
      order() { return b },
      limit() { return b },
      insert(payload) {
        inserts.push({ table, payload })
        // canned returned row for the two tables the routes read back an id from
        if (table === 'customers') b._canned = { data: { customer_id: 'cust-1' }, error: null }
        else if (table === 'agency_referrals') b._canned = { data: { referral_id: 'ref-1' }, error: null }
        else b._canned = { data: null, error: null }
        return b
      },
      maybeSingle() { return Promise.resolve(b._canned ?? { data: null, error: null }) },
      single() {
        // agency lookup + inserted-row read-backs
        if (table === 'agencies') return Promise.resolve({ data: { agency_id: 'ag-1', name: 'Test Agency', owner: 'Dana' }, error: null })
        return Promise.resolve(b._canned ?? { data: null, error: null })
      },
      then(resolve_) { resolve_(b._canned ?? { data: null, error: null }); }, // awaited insert()
    }
    return b
  }
  const storage = {
    from() {
      return {
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/x' } }),
      }
    },
  }
  return { from: (t) => builder(t), storage, _inserts: inserts }
}

function jsonReq(body, ip = '10.0.0.1') {
  return new Request('https://x/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}
function formReq(fields, ip = '10.0.0.2') {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return new Request('https://x/api', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: fd })
}

let passed = 0
const t = (name, fn) => fn().then(() => { passed++; console.log('  ✓', name) })

const run = async () => {
  // ── Honeypot: a filled `company` field writes NOTHING and returns ok ──────────────
  await t('referral honeypot → no DB write, ok response', async () => {
    globalThis.__SPY_DB__ = makeSpyDb()
    globalThis.__AUDITS__ = []
    const res = await referralPOST(jsonReq({ agency_slug: 'a', client_name: 'B', company: 'bot-co' }, '11.0.0.1'))
    assert.equal(res.status, 200)
    assert.equal(globalThis.__SPY_DB__._inserts.length, 0, 'honeypot must not insert anything')
  })
  await t('upload honeypot → no DB write, ok response', async () => {
    globalThis.__SPY_DB__ = makeSpyDb()
    const res = await uploadPOST(formReq({ agency_slug: 'a', document_type: 'id', company: 'bot-co' }, '11.0.0.2'))
    assert.equal(res.status, 200)
    assert.equal(globalThis.__SPY_DB__._inserts.length, 0, 'honeypot must not insert anything')
  })

  // ── Rate limit: the 6th request from one IP in the window is blocked (429) ────────
  await t('referral rate-limit blocks a flood (429) from one IP', async () => {
    globalThis.__SPY_DB__ = makeSpyDb()
    const ip = '22.0.0.9'
    let last
    for (let i = 0; i < 6; i++) last = await referralPOST(jsonReq({ agency_slug: 'a', client_name: 'B' }, ip))
    assert.equal(last.status, 429, 'the 6th request in the window should be rate-limited')
  })
  await t('upload rate-limit blocks a flood (429) from one IP', async () => {
    globalThis.__SPY_DB__ = makeSpyDb()
    const ip = '22.0.0.10'
    let last
    for (let i = 0; i < 6; i++) last = await uploadPOST(formReq({ agency_slug: 'a', document_type: 'id' }, ip))
    assert.equal(last.status, 429)
  })

  // ── Happy path: a clean request within the limit DOES write + audit ───────────────
  await t('referral happy path writes rows and audits', async () => {
    globalThis.__SPY_DB__ = makeSpyDb()
    globalThis.__AUDITS__ = []
    const res = await referralPOST(jsonReq({ agency_slug: 'a', client_name: 'Real Person', client_email: 'r@example.com' }, '33.0.0.1'))
    assert.equal(res.status, 200)
    const tables = globalThis.__SPY_DB__._inserts.map((i) => i.table)
    assert.ok(tables.includes('agency_referrals'), `expected an agency_referrals insert; got ${tables}`)
    assert.ok(globalThis.__AUDITS__.some((a) => a.entity === 'agency_referral'), 'a public referral must be audited')
  })
  await t('upload happy path writes the upload event and audits', async () => {
    globalThis.__SPY_DB__ = makeSpyDb()
    globalThis.__AUDITS__ = []
    const res = await uploadPOST(formReq({ agency_slug: 'a', document_type: 'id', customer_email: 'r@example.com', customer_name: 'Real Person' }, '33.0.0.2'))
    assert.equal(res.status, 200)
    const tables = globalThis.__SPY_DB__._inserts.map((i) => i.table)
    assert.ok(tables.includes('agency_uploads'), `expected an agency_uploads insert; got ${tables}`)
    assert.ok(globalThis.__AUDITS__.some((a) => a.entity === 'agency_upload'), 'a public upload must be audited')
  })

  console.log(`\nAll ${passed} assertions passed.`)
}

run().catch((e) => { console.error('\nFAIL:', e && e.stack ? e.stack : e); process.exit(1) })
