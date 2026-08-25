// tests/helpers/build-inbound-bundle.mjs
// TEST HARNESS ONLY. Bundles the REAL inbound/send code path (src/lib/comms/inbound.ts
// and src/lib/comms/send.ts, with their full transitive graph) into a single CJS module
// so it can be executed by node against a real Postgres.
//
// Exactly ONE module is substituted: `@/lib/supabase/client`, whose getDb() is redirected
// to the PostgREST-over-psql shim (globalThis.__FSOS_DB__). Nothing else is mocked at the
// module level — the gate, the AI-authority matrix, the dispatcher, consent, DNC,
// personalization, hours, A2P and the audit writer are the production modules. The two
// genuinely-external boundaries (Anthropic + Twilio HTTP) are intercepted at globalThis.fetch
// by the test, so the FSOS code that calls them still runs for real.
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = process.cwd()

const CLIENT_STUB = `
class ConfigError extends Error { constructor(m){ super(m); this.name='ConfigError' } }
function getDb() {
  const db = globalThis.__FSOS_DB__
  if (!db) throw new Error('test harness: globalThis.__FSOS_DB__ is not set')
  return db
}
function getBrowserDb() { throw new Error('test harness: browser client must not be used server-side') }
module.exports = { getDb, getBrowserDb, ConfigError }
`

/** Build the bundle; returns the path to the emitted CJS file. */
export async function buildInboundBundle() {
  const dir = mkdtempSync(join(tmpdir(), 'fsos-inbound-bundle-'))
  const stubPath = join(dir, 'supabase-client-stub.js')
  writeFileSync(stubPath, CLIENT_STUB)

  const entry = join(dir, 'entry.ts')
  writeFileSync(
    entry,
    `export { processInbound, classifyKeyword } from '@/lib/comms/inbound'\n` +
      `export { sendThroughGate } from '@/lib/comms/send'\n` +
      `export { getOrCreateConversation } from '@/lib/comms/conversations'\n` +
      `export { draftReply } from '@/lib/ai/responder'\n` +
      // The three campaign booking-exit seams, so the e2e suite can prove they behave
      // identically against real rows rather than only that book.ts calls them.
      `export { exitOnAppointment as exitWinback } from '@/lib/pipeline-winback/inbound'\n` +
      `export { exitOnAppointment as exitLife } from '@/lib/life-campaign/inbound'\n` +
      `export { exitOnAppointment as exitXsell } from '@/lib/cross-sell-life/inbound'\n` +
      // The resume-paused job, so the e2e suite can prove reply-terminated enrollments are NOT
      // resurrected by it while a benign conversational pause still resumes (FSOS-020).
      `export { resumePausedEnrollments } from '@/jobs/handlers'\n`,
  )

  const out = join(dir, 'bundle.cjs')
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
    // React-email / next-only modules are not on this path; if one ever is, the build
    // fails loudly rather than the test silently exercising a different code path.
    external: ['next/*', 'react', 'react-dom'],
    plugins: [
      {
        name: 'fsos-test-substitutions',
        setup(b) {
          // The ONLY module substitution: the Supabase client factory.
          b.onResolve({ filter: /(^|\/)supabase\/client$/ }, () => ({ path: stubPath }))
          // `@/…` path alias → src/…
          b.onResolve({ filter: /^@\// }, (a) => ({ path: resolve(ROOT, 'src', a.path.slice(2)) + guessExt(a.path) }))
        },
      },
    ],
  })
  return out
}

function guessExt(p) {
  // esbuild resolves extensions itself once the path exists; only add .ts when the
  // aliased path has no extension and a .ts file is the convention in this repo.
  return /\.[a-z]+$/.test(p) ? '' : '.ts'
}
