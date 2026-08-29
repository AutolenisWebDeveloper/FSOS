#!/usr/bin/env node
// FSOS test runner. Runs every tests/*.{mjs,mts} file, CONTINUING past failures so a
// single run surfaces ALL failing files (the previous `&&` chain stopped at the first,
// forcing a slow fix-one-rerun loop). New test files are picked up automatically — no
// hand-editing package.json.
//
// The infra/RLS proofs that stand up a root-owned Postgres are a separate, explicit set
// (`node scripts/run-tests.mjs rls`, run under sudo in CI). Everything else is `unit`.
// Exit code is non-zero iff any selected file failed, so CI gating is unchanged.
import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Proofs requiring a root Postgres (initdb + runuser -u postgres). Kept explicit so the
// `unit` set (run without sudo) never accidentally includes one.
const RLS = new Set([
  'rls-firewall.test.mjs',
  'comms-inbound-e2e.test.mjs',
  'customer-dob-plain.test.mjs',
  'import-mapping-migration.test.mjs',
  'ghl-optout-rollback.test.mjs',
  'booking-double-booking.test.mjs',
  'booking-reminder-idempotency.test.mjs',
  'booking-delivery-ledger.test.mjs',
  'booking-reschedule-move.test.mjs',
  'booking-google-connection.test.mjs',
  'booking-calendly-reconcile.test.mjs',
  'comm-template-version-history.test.mjs',
  'district-nurture-rls.test.mjs',
  'suppression-rpc.test.mjs',
  'booking-reschedule-self-exclude.test.mjs',
  // Applies the WHOLE migration chain to an empty database via the real migrate.mjs.
  // Needs root Postgres (initdb) and write access to the extension dir for its pg_cron stub.
  'migration-chain.test.mjs',
])

const mode = process.argv[2] === 'rls' ? 'rls' : 'unit'
const listOnly = process.argv.includes('--list')

const files = readdirSync('tests')
  .filter((f) => /\.(mjs|mts)$/.test(f))
  .sort()
const selected = files.filter((f) => (mode === 'rls' ? RLS.has(f) : !RLS.has(f)))

if (listOnly) {
  process.stdout.write(selected.join('\n') + '\n')
  process.exit(0)
}

const failed = []
for (const f of selected) {
  const [cmd, args] = f.endsWith('.mts') ? ['npx', ['tsx', `tests/${f}`]] : ['node', [`tests/${f}`]]
  process.stdout.write(`\n▶ ${f}\n`)
  try {
    execFileSync(cmd, args, { stdio: 'inherit', env: process.env })
  } catch {
    failed.push(f)
  }
}

if (failed.length) {
  console.error(`\n✗ ${failed.length}/${selected.length} ${mode} test file(s) FAILED:`)
  for (const f of failed) console.error('   ✗ ' + f)
  process.exit(1)
}
console.log(`\n✓ All ${selected.length} ${mode} test file(s) passed.`)
