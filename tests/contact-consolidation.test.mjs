// tests/contact-consolidation.test.mjs — Slice 1 (Contact consolidation & staging).
// Two proofs:
//   1. Re-import idempotency — importing the SAME list a second time creates ZERO
//      new contacts (every row resolves to a merge via the shared resolution engine,
//      not a create). This is the guarantee that replaces a unique DB constraint
//      (ADR-028): duplicates stay out without rejecting legitimate shared-contact
//      household members that a unique email/phone index would wrongly block.
//   2. The consolidation report shaper is a pure, correct transform.
//
// Run with: node tests/contact-consolidation.test.mjs
// The sources are TS; we bundle them to JS on the fly via esbuild if available,
// otherwise skip cleanly (build/CI compiles them anyway) — matching resolution.test.mjs.

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function bundle(entry) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'))
  const out = join(dir, 'mod.mjs')
  execSync(
    `npx --yes esbuild@0.21.5 ${entry} --bundle --platform=node --format=esm --packages=external --outfile=${out}`,
    { stdio: 'ignore' },
  )
  const mod = await import(out)
  rmSync(dir, { recursive: true, force: true })
  return mod
}

let reso, svc
try {
  reso = await bundle('src/lib/import/resolution.ts')
  svc = await bundle('src/lib/services/contactConsolidation.ts')
} catch (e) {
  if (process.env.CI_REQUIRE_INFRA === '1') {
    console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild is unavailable:', e.message)
    process.exit(1)
  }
  console.log('contact-consolidation.test.mjs — SKIPPED (esbuild unavailable):', e.message)
  process.exit(0)
}

const { buildContactIndex, resolveContact, emailKey, phoneKey } = reso
const { shapeConsolidationReport } = svc

let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg) }
  else { fail++; console.log('  ✗', msg) }
}

// ── 1. Re-import idempotency ──────────────────────────────────────────────────
// A realistic import list of DISTINCT people (unique email/phone each). Household
// members that share an identity are a Slice-3 concern; here we prove the core
// claim: the same file, imported twice, yields no second copy of anyone.
const importList = [
  { fullName: 'Aaron Gonzalez', email: 'aaron@example.com', phone: '(830) 430-9800' },
  { fullName: 'Maria Lopez', email: 'maria@example.com', phone: '361-555-0148' },
  { fullName: 'John Smith', phone: '210-555-1212' },
  { fullName: 'Dana Reyes', email: 'dana@example.com' },
]

// Simulate the importer's insert: a row that resolves to `create` becomes a new
// contact in the book (normalized dedupe keys), exactly as the route does.
let nextId = 1
const book = []
function importOnce(list) {
  const index = buildContactIndex(book)
  let creates = 0
  let merges = 0
  for (const row of list) {
    const res = resolveContact(index, { fullName: row.fullName, email: row.email, phone: row.phone })
    if (res.action === 'create') {
      creates++
      book.push({
        id: `c${nextId++}`,
        full_name: row.fullName,
        email_lc: emailKey(row.email),
        phone_digits: phoneKey(row.phone),
      })
    } else if (res.action === 'merge') {
      merges++
    }
  }
  return { creates, merges }
}

console.log('consolidation — re-import idempotency')
const first = importOnce(importList)
ok(first.creates === importList.length, `first import creates all ${importList.length} contacts`)
ok(book.length === importList.length, 'book holds exactly one row per person after first import')

const second = importOnce(importList)
ok(second.creates === 0, 're-import creates ZERO new contacts (idempotent)')
ok(second.merges === importList.length, 're-import resolves every row to an existing contact (merge)')
ok(book.length === importList.length, 'book size unchanged after re-import — no duplicates')

// A third pass, same result — stable, not just first-time luck.
const third = importOnce(importList)
ok(third.creates === 0 && book.length === importList.length, 'idempotent across repeated re-imports')

// ── 2. Report shaper purity/correctness ───────────────────────────────────────
console.log('consolidation — report shaper')
const report = shapeConsolidationReport(
  { total: 10, orphaned: 7, orphaned_eligible: 5, orphaned_ineligible: 2, linked: 3, with_email: 8, with_phone: 6, unreachable: 1, typed: 4, untyped: 6, active: 9, archived: 1 },
  2,
  [
    { source: 'import:csv', total: 3, orphaned: 3 },
    { source: 'ghl', total: 5, orphaned: 4 },
    { source: '(unspecified)', total: 2, orphaned: 0 },
  ],
)
ok(report.total === 10 && report.orphaned === 7 && report.linked === 3, 'summary counts mapped')
ok(report.orphanedEligible === 5 && report.orphanedIneligible === 2, 'eligible/ineligible orphan split mapped')
ok(report.duplicateGroups === 2, 'duplicate-group count carried through')
ok(report.bySource[0].source === 'ghl' && report.bySource[0].total === 5, 'sources sorted by total desc')
ok(report.unreachable === 1 && report.untyped === 6, 'reachability + typing counts mapped')

const empty = shapeConsolidationReport(null, 0, null)
ok(empty.total === 0 && empty.orphaned === 0 && empty.bySource.length === 0, 'null/empty inputs → all-zero report (never throws)')

const coerced = shapeConsolidationReport({ total: '5', orphaned: '2' }, '1', [{ source: '', total: '5', orphaned: '2' }])
ok(coerced.total === 5 && coerced.duplicateGroups === 1 && coerced.bySource[0].source === '(unspecified)', 'string counts coerced; blank source labeled')

console.log(`\n${pass} passed, ${fail} failed.`)
if (fail > 0) process.exit(1)
