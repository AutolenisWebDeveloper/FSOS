#!/usr/bin/env node
// FSOS test runner. Runs every tests/*.{mjs,mts} file, CONTINUING past failures so a
// single run surfaces ALL failing files (the previous `&&` chain stopped at the first,
// forcing a slow fix-one-rerun loop). New test files are picked up automatically — no
// hand-editing package.json.
//
// The infra/RLS proofs that stand up a root-owned Postgres are a separate, explicit set
// (`node scripts/run-tests.mjs rls`, run under sudo in CI). Everything else is `unit`.
// Exit code is non-zero iff any selected file failed, so CI gating is unchanged.
//
// EXPECTED-FAILURE MANIFEST (tests/expected-failures.json — Batch 0 exit gate, the
// WS-077 assertion contract): files pinned there are deliberately RED, each annotated
// with the WS finding that keeps it red and the batch that turns it green. The runner
// enforces the EXACT set both ways:
//   • an UNPINNED failure fails the run (as always), and
//   • a PINNED file that PASSES also fails the run — a stale pin or a vacuous assertion,
//     the same defect class the §11a sweep removed. Delete the manifest entry in the
//     commit that legitimately turns the file green.
// Manifest state is printed on every run so the remaining pinned-red set is visible.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
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
  // Migration 135 applied to a real Postgres: the APPROVED appointment SMS templates the send
  // path requires, and the booking consent-evidence columns.
  'booking-sms-templates-approved.test.mjs',
  // Applies the WHOLE migration chain to an empty database via the real migrate.mjs.
  // Needs root Postgres (initdb) and write access to the extension dir for its pg_cron stub.
  'migration-chain.test.mjs',
  // Batch 0 GUARANTEE tests — full engine + gate against ephemeral Postgres. Pinned RED
  // in tests/expected-failures.json until the batch named there lands.
  'workshop-guarantee-send-once.test.mjs',
  'workshop-guarantee-quiet-hours.test.mjs',
  'workshop-guarantee-suppression.test.mjs',
  'workshop-guarantee-termination.test.mjs',
  'workshop-registration-claim.test.mjs',
  // Batch 4 — lifecycle/change-comms guarantees (full engine + migration 130 triggers).
  'workshop-lifecycle.test.mjs',
  // Migration 134 — the opportunities de-dupe race, driven as overlapping transactions.
  'opportunity-referral-race.test.mjs',
])

const mode = process.argv[2] === 'rls' ? 'rls' : 'unit'
const listOnly = process.argv.includes('--list')

const MANIFEST_PATH = 'tests/expected-failures.json'
const manifest = existsSync(MANIFEST_PATH)
  ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))).filter(([k]) => k !== '//'))
  : {}

const files = readdirSync('tests')
  .filter((f) => /\.(mjs|mts)$/.test(f))
  .sort()
const selected = files.filter((f) => (mode === 'rls' ? RLS.has(f) : !RLS.has(f)))

// A manifest entry for a file that no longer exists is itself a defect (a silently
// deleted red test would otherwise read as progress).
const orphanPins = Object.keys(manifest).filter((f) => !files.includes(f))

if (listOnly) {
  process.stdout.write(selected.join('\n') + '\n')
  process.exit(0)
}

const failed = []
const passedFiles = []
for (const f of selected) {
  const [cmd, args] = f.endsWith('.mts') ? ['npx', ['tsx', `tests/${f}`]] : ['node', [`tests/${f}`]]
  const pin = manifest[f]
  process.stdout.write(`\n▶ ${f}${pin ? `   [PINNED RED — ${pin.ws}; green by ${pin.green_by}]` : ''}\n`)
  try {
    execFileSync(cmd, args, { stdio: 'inherit', env: process.env })
    passedFiles.push(f)
  } catch {
    failed.push(f)
  }
}

const unexpectedFailures = failed.filter((f) => !manifest[f])
const expectedFailures = failed.filter((f) => manifest[f])
const stalePins = passedFiles.filter((f) => manifest[f])

// Manifest state — printed every run so the remaining pinned-red set stays visible.
const pinsInThisMode = Object.keys(manifest).filter((f) => selected.includes(f))
if (Object.keys(manifest).length) {
  console.log(`\n── Expected-failure manifest: ${Object.keys(manifest).length} pin(s) total, ${pinsInThisMode.length} in this ${mode} run ──`)
  for (const [f, pin] of Object.entries(manifest)) {
    const state = stalePins.includes(f) ? 'PASSED (STALE PIN!)' : expectedFailures.includes(f) ? 'red as pinned' : selected.includes(f) ? 'red as pinned' : 'not in this mode'
    console.log(`   • ${f} — ${pin.ws} → green by ${pin.green_by} [${state}]`)
  }
}

let exitFail = false
if (unexpectedFailures.length) {
  console.error(`\n✗ ${unexpectedFailures.length}/${selected.length} ${mode} test file(s) FAILED (unpinned):`)
  for (const f of unexpectedFailures) console.error('   ✗ ' + f)
  exitFail = true
}
if (stalePins.length) {
  console.error(`\n✗ ${stalePins.length} PINNED file(s) PASSED — stale pin or vacuous assertion; remove the manifest entry in the commit that turns it green:`)
  for (const f of stalePins) console.error('   ✗ ' + f)
  exitFail = true
}
if (orphanPins.length) {
  console.error(`\n✗ ${orphanPins.length} manifest pin(s) reference a test file that does not exist:`)
  for (const f of orphanPins) console.error('   ✗ ' + f)
  exitFail = true
}
if (exitFail) process.exit(1)

const note = expectedFailures.length ? ` (${expectedFailures.length} pinned-red expected failure(s) — see manifest above)` : ''
console.log(`\n✓ All ${selected.length - expectedFailures.length} unpinned ${mode} test file(s) passed${note}.`)
