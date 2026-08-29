// tests/helpers/build-workshop-bundle.mjs
// TEST HARNESS ONLY. Bundles the REAL workshop comms engine (src/lib/workshops/
// comms-engine.ts with its full transitive graph — sendThroughGate, the 7-step gate,
// dispatcher, suppression, personalization, senders, audit) into a single CJS module so
// the four Batch-0 GUARANTEE tests can execute it against a real ephemeral Postgres.
//
// Exactly ONE module is substituted: `@/lib/supabase/client`, redirected to the
// PostgREST-over-psql shim via globalThis.__FSOS_DB__ (same contract as
// build-inbound-bundle.mjs). The two external provider boundaries (Resend + Twilio HTTP)
// are intercepted at globalThis.fetch by the test, so the production code that calls
// them still runs for real.
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
export async function buildWorkshopBundle() {
  const dir = mkdtempSync(join(tmpdir(), 'fsos-workshop-bundle-'))
  const stubPath = join(dir, 'supabase-client-stub.js')
  writeFileSync(stubPath, CLIENT_STUB)

  const entry = join(dir, 'entry.ts')
  writeFileSync(
    entry,
    `export { runReminderPass, runChangePass, runNurturePass, sendWorkshopMessage, sendCancelAcknowledgment } from '@/lib/workshops/comms-engine'\n` +
      `export { sendThroughGate } from '@/lib/comms/send'\n`,
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
    external: ['next/*', 'react', 'react-dom'],
    plugins: [
      {
        name: 'fsos-test-substitutions',
        setup(b) {
          b.onResolve({ filter: /(^|\/)supabase\/client$/ }, () => ({ path: stubPath }))
          b.onResolve({ filter: /^@\// }, (a) => ({ path: resolve(ROOT, 'src', a.path.slice(2)) + guessExt(a.path) }))
        },
      },
    ],
  })
  return out
}

function guessExt(p) {
  return /\.[a-z]+$/.test(p) ? '' : '.ts'
}
