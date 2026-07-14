#!/usr/bin/env node
// FSOS migrations runner. Applies supabase/migrations/*.sql in filename order.
//
// Usage:
//   DATABASE_URL=postgres://...  npm run migrate         # apply via psql
//   npm run migrate                                       # no DB → print ordered plan
//
// Migrations are written idempotently (CREATE TABLE IF NOT EXISTS, DROP POLICY IF
// EXISTS, ON CONFLICT), so re-running is safe. Applied files are recorded in
// schema_migrations for auditability.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'supabase', 'migrations')

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort() // 001_, 002_, … 009_, 010_ — lexical order matches intended order

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL

if (!dbUrl) {
  console.log('No DATABASE_URL / SUPABASE_DB_URL set. Migration plan (apply in this order):\n')
  for (const f of files) console.log('  •', f)
  console.log(
    '\nTo apply: set DATABASE_URL to your Supabase Postgres connection string and re-run,\n' +
      'or paste each file into the Supabase SQL Editor in the order above.',
  )
  process.exit(0)
}

function psql(sql) {
  return execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    encoding: 'utf8',
  })
}
function psqlFile(path) {
  execFileSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', path], { stdio: 'inherit' })
}

try {
  psql(
    'create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now());',
  )
  const applied = new Set(
    psql('select filename from schema_migrations;')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  )

  let count = 0
  for (const f of files) {
    if (applied.has(f)) {
      console.log('  ✓ already applied:', f)
      continue
    }
    console.log('  → applying:', f)
    psqlFile(join(dir, f))
    psql(`insert into schema_migrations (filename) values ('${f}') on conflict do nothing;`)
    count++
  }
  console.log(`\nDone. ${count} migration(s) applied.`)
} catch (err) {
  console.error('\nMigration failed:', err.message)
  console.error('Is `psql` installed and DATABASE_URL correct?')
  process.exit(1)
}
