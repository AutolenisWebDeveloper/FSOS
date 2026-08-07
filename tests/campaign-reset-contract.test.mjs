// tests/campaign-reset-contract.test.mjs
// GUARDRAIL test for the three-campaign reset (scripts/reset-campaigns.mjs).
//
// The reset deletes production execution data, so the risk is not "did it clear
// enough" — it is "did it clear something it must never touch". This proves the
// verification contract catches both failure directions:
//   • execution data that survived (enrollment / cascaded child rows), and
//   • a preserved table that moved — specifically the send/consent/audit record
//     that CLAUDE.md §12 and §13.9 require to survive any campaign operation.
//
// Pure — no DB. The script's contract is exported as data for exactly this reason.
// Run: node tests/campaign-reset-contract.test.mjs

import { PURGED, PRESERVED, APPEND_ONLY, QUEUE_PURGE, verifyReset, countedTables } from '../scripts/reset-campaigns.mjs'

let pass = 0, fail = 0
const ok = (c, m) => (c ? (pass++, console.log('  ✓', m)) : (fail++, console.log('  ✗', m)))

// Build a before/after pair representing a clean, correct reset.
const before = {}
const after = {}
for (const t of countedTables()) { before[t] = 5; after[t] = 5 }
for (const { table, cascades } of PURGED) {
  after[table] = 0
  for (const c of cascades) after[c] = 0
}
after.outreach_queue = 2
after.audit_log = before.audit_log + 4

console.log('campaign-reset-contract.test.mjs')

// ── The happy path verifies clean ──────────────────────────────────────────────
ok(verifyReset(before, after).ok, 'a correct reset verifies clean')

// ── Surviving execution data is caught ─────────────────────────────────────────
for (const { family, table } of PURGED) {
  const bad = { ...after, [table]: 1 }
  const r = verifyReset(before, bad)
  ok(!r.ok && r.problems.some((p) => p.includes(table)), `${family}: surviving ${table} row is caught`)
}

// ── A child row that failed to cascade is caught ───────────────────────────────
for (const { family, cascades } of PURGED) {
  for (const child of cascades) {
    const bad = { ...after, [child]: 3 }
    const r = verifyReset(before, bad)
    ok(!r.ok && r.problems.some((p) => p.includes(child)), `${family}: un-cascaded ${child} is caught`)
  }
}

// ── Every preserved table is genuinely load-bearing ────────────────────────────
// Each one, if it moves, must fail the reset. This is the clause that stops a
// future edit from quietly widening the blast radius.
for (const table of PRESERVED) {
  const shrunk = { ...after, [table]: before[table] - 1 }
  const r = verifyReset(before, shrunk)
  ok(!r.ok && r.problems.some((p) => p.startsWith('PRESERVATION BREACH') && p.includes(table)), `deleting from ${table} is a preservation breach`)
}

// ── The specific compliance record the request named as protected ──────────────
for (const table of ['comm_messages', 'comm_conversations', 'comm_message_events', 'consents', 'dnc_entries', 'comm_templates']) {
  ok(PRESERVED.includes(table), `${table} is in the preserved set (§12 / §13.9 record)`)
}

// The touch templates ARE the sequence blueprint — a reset that deletes them
// leaves nothing to restart.
for (const table of ['life_campaign_touches', 'pipeline_winback_touches', 'xsell_life_campaign_touches']) {
  ok(PRESERVED.includes(table), `${table} (sequence blueprint) survives the reset`)
}

// ── audit_log is append-only, never merely "unchanged" ─────────────────────────
ok(APPEND_ONLY.includes('audit_log'), 'audit_log is treated as append-only, not frozen')
ok(verifyReset(before, { ...after, audit_log: before.audit_log + 99 }).ok, 'audit_log growing is allowed')
ok(!verifyReset(before, { ...after, audit_log: before.audit_log - 1 }).ok, 'audit_log shrinking is an append-only breach')
ok(!PRESERVED.includes('audit_log'), 'audit_log is not double-counted in PRESERVED')

// ── The queue purge keeps gate-decision evidence ───────────────────────────────
ok(QUEUE_PURGE.deleteWhereStatus.includes('queued'), 'pending queue rows are purged')
ok(QUEUE_PURGE.keepStatus.includes('blocked'), "'blocked' queue rows survive — they record why the gate stopped a send")
ok(!QUEUE_PURGE.deleteWhereStatus.includes('blocked'), "'blocked' is never in the delete set")
ok(!QUEUE_PURGE.deleteWhereStatus.includes('sent'), "'sent' queue rows are never purged")

// ── Nothing outside the three families is in the purge set ─────────────────────
const purgedTables = PURGED.flatMap((p) => [p.table, ...p.cascades])
ok(purgedTables.every((t) => /^(life_|pipeline_winback_|xsell_life_)/.test(t)), 'purge set is confined to the three campaign families')
ok(!purgedTables.includes('contacts') && !purgedTables.includes('households'), 'contact/household profiles are never purged')
ok(purgedTables.length === 9, 'purge set is exactly 3 roots + 6 cascaded children')

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
