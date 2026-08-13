// tests/household-deletion.test.mjs — CRM book (households) archive + PERMANENT delete.
// Proves the safety guard (a non-discriminating filter never mass-deletes the book), the
// dryRun count preview, and that both archive (recoverable) and purge (hard delete) resolve
// + act on the right households via explicit ids or a referring-agency filter.
//
// The service imports the audit writer (→ getDb), which fails CLOSED with no Supabase env;
// writeAudit swallows that, so the deletion logic runs against an in-memory stub db without
// a database. Bundled with esbuild like contact-deletion.test.mjs.
// Run with: node tests/household-deletion.test.mjs

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

let m
try {
  const dir = mkdtempSync(join(process.cwd(), 'node_modules', '.hdel-'))
  const out = join(dir, 'mod.mjs')
  execSync(
    `npx --yes esbuild@0.21.5 src/lib/services/householdDeletion.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src --outfile=${out}`,
    { stdio: 'ignore' },
  )
  m = await import(out)
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  if (process.env.CI_REQUIRE_INFRA === '1') { console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild unavailable:', e.message); process.exit(1) }
  console.log('household-deletion.test.mjs — SKIPPED (esbuild unavailable):', e.message); process.exit(0)
}
const { isDiscriminatingFilter, normalizeFilter, resolveFilterHouseholdIds, deleteHouseholds } = m

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg) } else { fail++; console.log('  ✗', msg) } }

// ── In-memory stub db supporting the chains the service builds. ─────────────────
function makeDb(dataset) {
  const deleted = new Set()
  const archived = new Map() // id -> archived_at
  const isLive = (r) => !deleted.has(r.id) && !r.deleted_at
  const rowsMatching = (preds) => dataset.filter(isLive).filter((r) => preds.every((p) => p(r)))
  function builder() {
    const preds = []
    let op = 'select'
    let patch = null
    const b = {
      select() { return b },
      delete() { op = 'delete'; return b },
      update(p) { op = 'update'; patch = p; return b },
      is(col, val) { preds.push((r) => (col === 'deleted_at' && val === null ? !r.deleted_at : col === 'archived_at' && val === null ? !effArchived(r) : true)); return b },
      not(col, _op, val) { preds.push((r) => (col === 'archived_at' && val === null ? !!effArchived(r) : true)); return b },
      eq(col, val) { preds.push((r) => r[col] === val); return b },
      in(col, vals) { preds.push((r) => vals.includes(r[col])); return b },
      order() { return b },
      range(from, to) {
        const rows = rowsMatching(preds)
        return Promise.resolve({ data: rows.slice(from, to + 1).map((r) => ({ id: r.id })), error: null })
      },
      then(resolve) {
        const rows = rowsMatching(preds)
        if (op === 'delete') { rows.forEach((r) => deleted.add(r.id)); resolve({ error: null }) }
        else if (op === 'update') { rows.forEach((r) => archived.set(r.id, patch.archived_at)); resolve({ error: null }) }
        else resolve({ data: rows.map((r) => ({ id: r.id })), error: null })
      },
    }
    function effArchived(r) { return archived.has(r.id) ? archived.get(r.id) : r.archived_at }
    return b
  }
  return { from: () => builder(), deleted, archived }
}

const seed = () => [
  { id: 'h1', referring_agency_id: 'ag1', archived_at: null },
  { id: 'h2', referring_agency_id: 'ag1', archived_at: null },
  { id: 'h3', referring_agency_id: 'ag2', archived_at: null },
  { id: 'h4', referring_agency_id: 'ag2', archived_at: '2026-01-01T00:00:00Z' }, // already archived
]

console.log('household-deletion — discriminating filter guard')
ok(isDiscriminatingFilter({ referringAgencyId: 'ag1' }), 'agency is discriminating')
ok(!isDiscriminatingFilter({ scope: 'active' }), 'scope-only is NOT discriminating')
ok(!isDiscriminatingFilter({}), 'empty filter is NOT discriminating')
ok(!isDiscriminatingFilter(null), 'null filter is NOT discriminating')

console.log('household-deletion — normalizeFilter')
ok(normalizeFilter({ referringAgencyId: '  ' }).referringAgencyId === undefined, 'blank agency trims to undefined')
ok(normalizeFilter({}).scope === 'active', 'scope defaults to active')
ok(normalizeFilter({ scope: 'all' }).scope === 'all', 'all scope preserved')

console.log('household-deletion — resolveFilterHouseholdIds')
const ids1 = await resolveFilterHouseholdIds(makeDb(seed()), { referringAgencyId: 'ag1' })
ok(ids1.length === 2 && ids1.includes('h1') && ids1.includes('h2'), 'agency filter resolves the 2 active ag1 households')
const ids2 = await resolveFilterHouseholdIds(makeDb(seed()), { referringAgencyId: 'ag2' })
ok(ids2.length === 1 && ids2[0] === 'h3', 'active scope excludes the archived h4')
const ids3 = await resolveFilterHouseholdIds(makeDb(seed()), { referringAgencyId: 'ag2', scope: 'all' })
ok(ids3.length === 2, 'scope:all includes archived')
const ids4 = await resolveFilterHouseholdIds(makeDb(seed()), { referringAgencyId: 'ag2', scope: 'archived' })
ok(ids4.length === 1 && ids4[0] === 'h4', 'archived scope returns only archived')

console.log('household-deletion — refuses unbounded delete')
const noTarget = await deleteHouseholds(makeDb(seed()), { filter: { scope: 'active' }, mode: 'purge', actor: 'u1' })
ok(!noTarget.ok && noTarget.error === 'no_target', 'scope-only filter → no_target (refused)')
const noTarget2 = await deleteHouseholds(makeDb(seed()), { mode: 'purge', actor: 'u1' })
ok(!noTarget2.ok && noTarget2.error === 'no_target', 'no ids + no filter → no_target')

console.log('household-deletion — dryRun previews without changing anything')
const dbA = makeDb(seed())
const dry = await deleteHouseholds(dbA, { filter: { referringAgencyId: 'ag1' }, mode: 'purge', actor: 'u1', dryRun: true })
ok(dry.ok && dry.count === 2 && dry.affected === 0, 'dryRun returns count, changes nothing')
ok(dbA.deleted.size === 0 && dbA.archived.size === 0, 'nothing removed or archived on dryRun')

console.log('household-deletion — purge (filter) hard-deletes')
const dbB = makeDb(seed())
const purge = await deleteHouseholds(dbB, { filter: { referringAgencyId: 'ag1' }, mode: 'purge', actor: 'u1' })
ok(purge.ok && purge.affected === 2 && purge.mode === 'purge', 'filter purge removes 2')
ok(dbB.deleted.has('h1') && dbB.deleted.has('h2') && !dbB.deleted.has('h3'), 'only matching households removed')

console.log('household-deletion — archive (selection) sets archived_at, does not delete')
const dbC = makeDb(seed())
const arch = await deleteHouseholds(dbC, { ids: ['h3'], mode: 'archive', actor: 'u1' })
ok(arch.ok && arch.affected === 1 && arch.mode === 'archive', 'archive affects 1')
ok(dbC.archived.has('h3') && dbC.deleted.size === 0, 'h3 archived, nothing hard-deleted')

console.log('household-deletion — selection purge drops bogus ids')
const dbD = makeDb(seed())
const sel = await deleteHouseholds(dbD, { ids: ['h3', 'nope'], mode: 'purge', actor: 'u1' })
ok(sel.ok && sel.affected === 1, 'selection purge removes only the real household')
ok(dbD.deleted.has('h3') && dbD.deleted.size === 1, 'only h3 removed')

console.log(`\nhousehold-deletion — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
