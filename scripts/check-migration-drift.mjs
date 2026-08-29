#!/usr/bin/env node
// FSOS migration DRIFT CHECK — does a given database actually carry every migration in
// this repository?
//
// WHY THIS EXISTS. On 2026-08-29, migrations 123 and 124 merged and deployed to production
// while the production database still lacked their columns. Nothing surfaced it: CI ran
// type-check/lint/test/build but never looked at a migration, and production had no
// `schema_migrations` ledger at all, so neither side could answer the question. The
// resulting failure mode was silent — src/lib/comms/send.ts writes the new columns on
// EVERY dispatch, PostgREST returns 42703 in an unchecked `error` field, and the whole
// send-outcome patch no-ops without throwing.
//
// This is the deploy-side half of the guard. The repo-side half —
// "does the chain even apply?" — is tests/migration-chain.test.mjs.
//
// Usage:
//   DATABASE_URL=postgres://...  node scripts/check-migration-drift.mjs
//   MIGRATION_DRIFT_REQUIRE=1    node scripts/check-migration-drift.mjs   # no URL = FAIL
//
// Exit codes: 0 = in sync (or cleanly skipped), 1 = drift / cannot verify.
//
// It NEVER writes: no DDL, no ledger inserts, no migrations applied. Read-only by design,
// so it is safe to point at production.
import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'supabase', 'migrations')

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL

if (!dbUrl) {
  // Mirrors the CI_REQUIRE_INFRA convention used by the RLS proofs: a check that cannot
  // run must say so out loud. It is never reported as a pass-with-verification.
  if (process.env.MIGRATION_DRIFT_REQUIRE === '1') {
    console.error('FAIL: MIGRATION_DRIFT_REQUIRE=1 but no DATABASE_URL / SUPABASE_DB_URL is set.')
    console.error('The drift check cannot verify the schema without a connection string.')
    process.exit(1)
  }
  console.log('SKIP: no DATABASE_URL / SUPABASE_DB_URL set — schema drift NOT verified.')
  console.log(`(${files.length} migration file(s) in ${dir})`)
  process.exit(0)
}

function psql(sql) {
  return execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], { encoding: 'utf8' })
}

let applied
try {
  const hasLedger = psql("select to_regclass('public.schema_migrations') is not null").trim()
  if (hasLedger !== 't') {
    console.error('FAIL: the target database has no `schema_migrations` ledger.')
    console.error('Without it nothing can say which migrations are applied, and a recovery')
    console.error('`npm run migrate` would re-run EVERY file (backfills included).')
    console.error('Reconcile the database first, then seed the ledger with what is verified applied.')
    process.exit(1)
  }
  applied = new Set(
    psql('select filename from schema_migrations')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  )
} catch (err) {
  console.error('FAIL: could not read schema_migrations:', err.message)
  console.error('Is `psql` installed and the connection string correct?')
  process.exit(1)
}

const pending = files.filter((f) => !applied.has(f))
const unknown = [...applied].filter((f) => !files.includes(f)).sort()

console.log(`Migration drift check — ${files.length} file(s) in repo, ${applied.size} recorded in the database.`)

if (unknown.length) {
  // Not fatal: a ledger row with no file usually means the migration was renamed or
  // removed from the repo after being applied. Worth seeing, never worth blocking on.
  console.log(`\n  ${unknown.length} ledger entr(ies) with no matching file (renamed/removed?):`)
  for (const f of unknown) console.log('    ?', f)
}

if (pending.length) {
  console.error(`\n✗ DRIFT: ${pending.length} migration(s) in the repo are NOT applied to this database:`)
  for (const f of pending) console.error('    →', f)
  console.error('\nApply them before (or with) the deploy that depends on them. A deploy that')
  console.error('ships code ahead of its schema fails silently at the PostgREST layer.')
  process.exit(1)
}

console.log('\n✓ In sync — every migration in the repo is recorded as applied.')
