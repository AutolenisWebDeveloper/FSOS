// tests/agency-deletion.test.mjs — Agency directory archive + PERMANENT delete.
// Proves the safety guard (a non-discriminating filter never mass-deletes the directory),
// the dryRun count preview, and that both archive (recoverable) and purge (hard delete)
// resolve + act on the right agencies via explicit ids or a status filter.
//
// The service imports the audit writer (→ getDb), which fails CLOSED with no Supabase env;
// writeAudit swallows that, so the deletion logic runs against an in-memory stub db without
// a database. Bundled with esbuild like household-deletion.test.mjs.
// Run with: node tests/agency-deletion.test.mjs

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

let m
try {
  const dir = mkdtempSync(join(process.cwd(), 'node_modules', '.adel-'))
  const out = join(dir, 'mod.mjs')
  execSync(
    `npx --yes esbuild@0.21.5 src/lib/services/agencyDeletion.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src --outfile=${out}`,
    { stdio: 'ignore' },
  )
  m = await import(out)
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  if (process.env.CI_REQUIRE_INFRA === '1') { console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild unavailable:', e.message); process.exit(1) }
  console.log('agency-deletion.test.mjs — SKIPPED (esbuild unavailable):', e.message); process.exit(0)
}
const { isDiscriminatingFilter, normalizeFilter, resolveFilterAgencyIds, deleteAgencies } = m

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg) } else { fail++; console.log('  ✗', msg) } }

// ── In-memory stub db supporting the chains the service builds. ─────────────────
function makeDb(dataset) {
  const deleted = new Set()
  const archived = new Map()
  const isLive = (r) => !deleted.has(r.id) && !r.deleted_at
  const effArchived = (r) => (archived.has(r.id) ? archived.get(r.id) : r.archived_at)
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
    return b
  }
  return { from: () => builder(), deleted, archived }
}

const seed = () => [
  { id: 'a1', status: 'producing', archived_at: null },
  { id: 'a2', status: 'producing', archived_at: null },
  { id: 'a3', status: 'prospective', archived_at: null },
  { id: 'a4', status: 'terminated', archived_at: '2026-01-01T00:00:00Z' }, // already archived
]

console.log('agency-deletion — discriminating filter guard')
ok(isDiscriminatingFilter({ status: 'producing' }), 'status is discriminating')
ok(!isDiscriminatingFilter({ scope: 'active' }), 'scope-only is NOT discriminating')
ok(!isDiscriminatingFilter({}), 'empty filter is NOT discriminating')
ok(!isDiscriminatingFilter(null), 'null filter is NOT discriminating')

console.log('agency-deletion — normalizeFilter')
ok(normalizeFilter({ status: '  ' }).status === undefined, 'blank status trims to undefined')
ok(normalizeFilter({}).scope === 'active', 'scope defaults to active')
ok(normalizeFilter({ scope: 'all' }).scope === 'all', 'all scope preserved')

console.log('agency-deletion — resolveFilterAgencyIds')
const ids1 = await resolveFilterAgencyIds(makeDb(seed()), { status: 'producing' })
ok(ids1.length === 2 && ids1.includes('a1') && ids1.includes('a2'), 'status filter resolves the 2 active producing agencies')
const ids2 = await resolveFilterAgencyIds(makeDb(seed()), { status: 'terminated' })
ok(ids2.length === 0, 'active scope excludes the archived terminated agency')
const ids3 = await resolveFilterAgencyIds(makeDb(seed()), { status: 'terminated', scope: 'all' })
ok(ids3.length === 1 && ids3[0] === 'a4', 'status:all includes archived')

console.log('agency-deletion — refuses unbounded delete')
const noTarget = await deleteAgencies(makeDb(seed()), { filter: { scope: 'active' }, mode: 'purge', actor: 'u1' })
ok(!noTarget.ok && noTarget.error === 'no_target', 'scope-only filter → no_target (refused)')
const noTarget2 = await deleteAgencies(makeDb(seed()), { mode: 'purge', actor: 'u1' })
ok(!noTarget2.ok && noTarget2.error === 'no_target', 'no ids + no filter → no_target')

console.log('agency-deletion — dryRun previews without changing anything')
const dbA = makeDb(seed())
const dry = await deleteAgencies(dbA, { filter: { status: 'producing' }, mode: 'purge', actor: 'u1', dryRun: true })
ok(dry.ok && dry.count === 2 && dry.affected === 0, 'dryRun returns count, changes nothing')
ok(dbA.deleted.size === 0 && dbA.archived.size === 0, 'nothing removed or archived on dryRun')

console.log('agency-deletion — purge (filter) hard-deletes')
const dbB = makeDb(seed())
const purge = await deleteAgencies(dbB, { filter: { status: 'producing' }, mode: 'purge', actor: 'u1' })
ok(purge.ok && purge.affected === 2 && purge.mode === 'purge', 'filter purge removes 2')
ok(dbB.deleted.has('a1') && dbB.deleted.has('a2') && !dbB.deleted.has('a3'), 'only matching agencies removed')

console.log('agency-deletion — archive (selection) sets archived_at, does not delete')
const dbC = makeDb(seed())
const arch = await deleteAgencies(dbC, { ids: ['a3'], mode: 'archive', actor: 'u1' })
ok(arch.ok && arch.affected === 1 && arch.mode === 'archive', 'archive affects 1')
ok(dbC.archived.has('a3') && dbC.deleted.size === 0, 'a3 archived, nothing hard-deleted')

console.log('agency-deletion — selection purge drops bogus ids')
const dbD = makeDb(seed())
const sel = await deleteAgencies(dbD, { ids: ['a3', 'nope'], mode: 'purge', actor: 'u1' })
ok(sel.ok && sel.affected === 1, 'selection purge removes only the real agency')
ok(dbD.deleted.has('a3') && dbD.deleted.size === 1, 'only a3 removed')

console.log(`\nagency-deletion — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
