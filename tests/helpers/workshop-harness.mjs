// tests/helpers/workshop-harness.mjs
// Shared route/service execution harness for the workshop test suite (Batch 0, D-9(b)).
// Not a test file itself — scripts/run-tests.mjs only discovers tests/*.mjs, so helpers/
// is invisible to the runner. Reused by every workshop test that EXECUTES production
// modules instead of regexing their source (the §11a false-green class this replaces).
//
// What it provides:
//   • tsc(rel, dir)      — compile ONE standalone lib file with the repo's tsc (the
//                          established pattern from tests/workshop-ops.test.mjs).
//   • bundle(entry, opts)— esbuild-bundle a src/ module or route with the repo's `@/`
//                          alias resolved to real source, `@/lib/supabase/client` and
//                          `@/lib/audit/log` stubbed (recording), and `next/server`
//                          replaced by a minimal Request/Response shim so route handlers
//                          run in bare node. Pattern from tests/operational-email.test.mjs.
//   • fakeDb(script)     — scripted PostgREST-chain fake. Each `.from(table)` consumes the
//                          next scripted response for that table (or null) and RECORDS the
//                          full call (table, filters, method, payload) on `calls` so tests
//                          assert what the code actually did. Never talks to a network.
//   • auditCalls()       — the recorded writeAudit invocations from the audit stub.
//
// Honesty note: fakes prove code behavior (which queries run, what gets written, which
// branches fire). They do NOT prove live PostgREST semantics — schema-level proofs (unique
// violations, RLS) live in the ephemeral-Postgres suite (`npm run test:rls`).
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-wharness-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})
const require = createRequire(import.meta.url)

/** Compile one standalone lib file with the project's tsc; returns the required module. */
export function tsc(rel, sub) {
  const dir = join(out, sub)
  execSync(
    `npx tsc ${rel} --outDir ${dir} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
    { cwd: root, stdio: 'inherit' },
  )
  const base = rel.split('/').pop().replace(/\.tsx?$/, '.js')
  return require(join(dir, base))
}

// ── Stub modules (written once, shared by every bundle) ─────────────────────────
// State lives on globalThis so the bundled CJS and the test share it.
globalThis.__wsAuditCalls = globalThis.__wsAuditCalls ?? []

const nextServerStub = join(out, 'next-server-stub.mjs')
writeFileSync(
  nextServerStub,
  `export class NextRequest extends Request {}
   export class NextResponse extends Response {
     static json(body, init) {
       return new Response(JSON.stringify(body), {
         status: init?.status ?? 200,
         headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
       })
     }
     static redirect(url, status) {
       return new Response(null, { status: status ?? 307, headers: { location: String(url) } })
     }
   }`,
)

const auditStub = join(out, 'audit-stub.mjs')
writeFileSync(
  auditStub,
  `export async function writeAudit(entry) { globalThis.__wsAuditCalls.push(entry); return { ok: true } }
   export default { writeAudit }`,
)

// getDb() returns whatever the test installed on globalThis.__wsDb; a test that expects a
// code path NEVER to touch the db leaves it unset and getDb throws loudly.
const dbStub = join(out, 'db-stub.mjs')
writeFileSync(
  dbStub,
  `export class ConfigError extends Error {}
   export function getDb() {
     if (!globalThis.__wsDb) throw new Error('db_not_available_in_test (this code path must not reach the database)')
     return globalThis.__wsDb
   }
   export function getBrowserDb() { return getDb() }`,
)

const stubPlugin = {
  name: 'workshop-harness-stubs',
  setup(b) {
    b.onResolve({ filter: /^next\/server$/ }, () => ({ path: nextServerStub }))
    b.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: dbStub }))
    b.onResolve({ filter: /^@\/lib\/audit\/log$/ }, () => ({ path: auditStub }))
    b.onResolve({ filter: /^@\// }, (args) => {
      const rel = args.path.slice(2)
      for (const ext of ['.ts', '.tsx', '/index.ts', '.mjs', '.js']) {
        const p = join(root, 'src', rel + ext)
        try { readFileSync(p); return { path: p } } catch { /* try next */ }
      }
      return { path: join(root, 'src', rel + '.ts') }
    })
  },
}

/**
 * esbuild-bundle a src entry (service or route) to CJS and require it.
 * opts.aliases: { '@/lib/comms/send': '/abs/path/to/stub.mjs' } — per-call module
 * substitutions resolved BEFORE the standard stubs (used by removal-guard tests that
 * record a production call boundary).
 */
export async function bundle(entry, opts = {}) {
  const aliasKey = Object.keys(opts.aliases ?? {}).join('|')
  const outfile = join(out, (entry + '_' + aliasKey).replace(/[/.[\]()|@]/g, '_') + '.cjs')
  const aliasPlugin = {
    name: 'workshop-harness-extra-aliases',
    setup(b) {
      for (const [mod, path] of Object.entries(opts.aliases ?? {})) {
        const filter = new RegExp(`^${mod.replace(/[/@]/g, (c) => `\\${c}`)}$`)
        b.onResolve({ filter }, () => ({ path }))
      }
    },
  }
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile,
    logLevel: 'silent',
    plugins: [aliasPlugin, stubPlugin],
  })
  return require(outfile)
}

/** Recorded writeAudit calls (reset with resetAudit()). */
export function auditCalls() { return globalThis.__wsAuditCalls }
export function resetAudit() { globalThis.__wsAuditCalls = [] }

/**
 * Scripted PostgREST-chain fake.
 *   fakeDb({ workshop_sessions: [{ id: 's1' }], workshop_registrations: [null, { reg_id: 'r1' }] })
 * Each .from('t') chain terminal consumes t's NEXT scripted value (default null).
 * Terminals: maybeSingle/single resolve { data, error: null }; a bare awaited chain (insert/
 * update/upsert/delete with no .select()) resolves { data, error: null } too.
 * Every chain records { table, method, filters: {eq/neq/...}, payload, selected } in calls[].
 */
export function fakeDb(script = {}) {
  const remaining = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]))
  const calls = []
  const db = {
    calls,
    from(table) {
      const call = { table, method: 'select', filters: [], payload: null, selected: null }
      calls.push(call)
      const next = () => {
        const v = remaining[table]?.length ? remaining[table].shift() : null
        if (v && typeof v === 'object' && v.__throw) throw new Error(String(v.__throw))
        return v
      }
      const chain = {
        select(cols) { call.selected = cols; return chain },
        insert(p) { call.method = 'insert'; call.payload = p; return chain },
        update(p) { call.method = 'update'; call.payload = p; return chain },
        upsert(p, opts) { call.method = 'upsert'; call.payload = p; call.upsertOpts = opts; return chain },
        delete() { call.method = 'delete'; return chain },
        eq(k, v) { call.filters.push(['eq', k, v]); return chain },
        neq(k, v) { call.filters.push(['neq', k, v]); return chain },
        in(k, v) { call.filters.push(['in', k, v]); return chain },
        is(k, v) { call.filters.push(['is', k, v]); return chain },
        not(k, op, v) { call.filters.push(['not', k, op, v]); return chain },
        gte(k, v) { call.filters.push(['gte', k, v]); return chain },
        lte(k, v) { call.filters.push(['lte', k, v]); return chain },
        gt(k, v) { call.filters.push(['gt', k, v]); return chain },
        lt(k, v) { call.filters.push(['lt', k, v]); return chain },
        ilike(k, v) { call.filters.push(['ilike', k, v]); return chain },
        or(expr) { call.filters.push(['or', expr]); return chain },
        order() { return chain },
        limit() { return chain },
        maybeSingle: async () => ({ data: next(), error: null }),
        single: async () => ({ data: next(), error: null }),
        then(resolve) { resolve({ data: next(), error: null }) },
      }
      return chain
    },
  }
  return db
}

/** Install a fakeDb as the stubbed getDb() result; returns it. Pass null to clear. */
export function installDb(db) {
  globalThis.__wsDb = db
  return db
}

/** Build a NextRequest-compatible Request for a bundled route handler. */
export function makeReq(url, { method = 'POST', body, headers = {} } = {}) {
  return new Request(url.startsWith('http') ? url : `http://localhost${url}`, {
    method,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers,
  })
}
