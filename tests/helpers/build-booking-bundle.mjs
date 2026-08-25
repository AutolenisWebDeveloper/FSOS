// tests/helpers/build-booking-bundle.mjs
// TEST HARNESS ONLY. Bundles the REAL availability calculator (src/lib/booking/slots.ts +
// its transitive graph) into one CJS module so it can run against a real Postgres. Exactly
// ONE module is substituted: `@/lib/supabase/client`, whose getDb() is redirected to the
// PostgREST-over-psql shim (globalThis.__FSOS_DB__). The Google busy loader degrades to a
// clean no-op with no Google env (googleCalendarConfigured()===false), so no calendar
// tables are needed. Used to prove FSOS-042 (reschedule self-exclusion) against real rows.
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

export async function buildBookingBundle() {
  const dir = mkdtempSync(join(tmpdir(), 'fsos-booking-bundle-'))
  const stubPath = join(dir, 'supabase-client-stub.js')
  writeFileSync(stubPath, CLIENT_STUB)

  const entry = join(dir, 'entry.ts')
  writeFileSync(entry, `export { computeSlotsForType, loadActiveType } from '@/lib/booking/slots'\n`)

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
