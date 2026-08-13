// tests/contact-deletion.test.mjs — Contact Center PERMANENT (hard) deletion service.
// Proves the safety guard (a non-discriminating filter never mass-deletes), the
// dryRun count preview, and that both the explicit-selection and the
// campaign/agency/group filter paths resolve + hard-delete the right rows.
//
// The service imports the audit writer (→ getDb), which fails CLOSED with no Supabase
// env; writeAudit swallows that, so the deletion logic is exercised against an
// in-memory stub db without a database. Bundled with esbuild like segments.test.mjs.
// Run with: node tests/contact-deletion.test.mjs

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Ensure the audit writer's getDb() throws ConfigError (fast, no network) rather than
// attempting a real insert during the delete path.
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

let m
try {
  // Emit the bundle inside the repo so Node resolves the externalized
  // @supabase/supabase-js from the project's node_modules.
  const dir = mkdtempSync(join(process.cwd(), 'node_modules', '.cdel-'))
  const out = join(dir, 'mod.mjs')
  execSync(
    `npx --yes esbuild@0.21.5 src/lib/services/contactDeletion.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src --outfile=${out}`,
    { stdio: 'ignore' },
  )
  m = await import(out)
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  if (process.env.CI_REQUIRE_INFRA === '1') { console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild unavailable:', e.message); process.exit(1) }
  console.log('contact-deletion.test.mjs — SKIPPED (esbuild unavailable):', e.message); process.exit(0)
}
const { isDiscriminatingFilter, normalizeFilter, resolveFilterContactIds, purgeContacts } = m

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg) } else { fail++; console.log('  ✗', msg) } }

// ── In-memory stub db that supports the chains the service builds. ──────────────
function makeDb(dataset) {
  const deleted = new Set()
  const rowsMatching = (preds) => dataset.filter((r) => !deleted.has(r.id)).filter((r) => preds.every((p) => p(r)))
  function builder() {
    const preds = []
    let isDelete = false
    const b = {
      select() { return b },
      delete() { isDelete = true; return b },
      is(col, val) { preds.push((r) => (col === 'deleted_at' && val === null ? !r.deleted_at : true)); return b },
      eq(col, val) { preds.push((r) => r[col] === val); return b },
      in(col, vals) { preds.push((r) => vals.includes(r[col])); return b },
      contains(col, arr) { preds.push((r) => arr.every((x) => (r[col] || []).includes(x))); return b },
      order() { return b },
      range(from, to) {
        const rows = rowsMatching(preds)
        return Promise.resolve({ data: rows.slice(from, to + 1).map((r) => ({ id: r.id })), error: null })
      },
      then(resolve) {
        const rows = rowsMatching(preds)
        if (isDelete) { rows.forEach((r) => deleted.add(r.id)); resolve({ error: null }) }
        else resolve({ data: rows.map((r) => ({ id: r.id })), error: null })
      },
    }
    return b
  }
  return { from: () => builder(), deleted }
}

const seed = () => [
  { id: 'a1', status: 'active', agency_partnership_id: 'ag1', source: 'winback_life', contact_type: 'client', tags: ['WIN-BACK'] },
  { id: 'a2', status: 'active', agency_partnership_id: 'ag1', source: 'winback_life', contact_type: 'client', tags: ['WIN-BACK', 'NEEDS-REVIEW'] },
  { id: 'a3', status: 'active', agency_partnership_id: 'ag2', source: 'cross_sell', contact_type: 'prospect', tags: ['NEEDS-REVIEW'] },
  { id: 'a4', status: 'archived', agency_partnership_id: 'ag2', source: 'cross_sell', contact_type: 'prospect', tags: [] },
]

console.log('contact-deletion — discriminating filter guard')
ok(isDiscriminatingFilter({ source: 'winback_life' }), 'campaign source is discriminating')
ok(isDiscriminatingFilter({ agencyPartnershipId: 'ag1' }), 'agency is discriminating')
ok(isDiscriminatingFilter({ tag: 'WIN-BACK' }), 'group tag is discriminating')
ok(isDiscriminatingFilter({ contactType: 'client' }), 'type is discriminating')
ok(!isDiscriminatingFilter({ status: 'active' }), 'status-only is NOT discriminating')
ok(!isDiscriminatingFilter({}), 'empty filter is NOT discriminating')
ok(!isDiscriminatingFilter(null), 'null filter is NOT discriminating')

console.log('contact-deletion — normalizeFilter')
ok(normalizeFilter({ source: '  ' }).source === undefined, 'blank source trims to undefined')
ok(normalizeFilter({}).status === 'active', 'status defaults to active')
ok(normalizeFilter({ status: 'archived' }).status === 'archived', 'archived status preserved')
ok(normalizeFilter({ status: 'all' }).status === 'all', 'all status preserved')

console.log('contact-deletion — resolveFilterContactIds')
const ids1 = await resolveFilterContactIds(makeDb(seed()), { source: 'winback_life' })
ok(ids1.length === 2 && ids1.includes('a1') && ids1.includes('a2'), 'campaign filter resolves the 2 active winback rows')
const ids2 = await resolveFilterContactIds(makeDb(seed()), { agencyPartnershipId: 'ag2' })
ok(ids2.length === 1 && ids2[0] === 'a3', 'agency filter defaults to active only (excludes archived a4)')
const ids3 = await resolveFilterContactIds(makeDb(seed()), { agencyPartnershipId: 'ag2', status: 'all' })
ok(ids3.length === 2, 'status:all includes archived')
const ids4 = await resolveFilterContactIds(makeDb(seed()), { tag: 'NEEDS-REVIEW' })
ok(ids4.length === 2 && ids4.includes('a2') && ids4.includes('a3'), 'group tag filter matches tag members')

console.log('contact-deletion — purgeContacts refuses unbounded delete')
const noTarget = await purgeContacts(makeDb(seed()), { filter: { status: 'active' }, actor: 'u1' })
ok(!noTarget.ok && noTarget.error === 'no_target', 'status-only filter → no_target (refused)')
const noTarget2 = await purgeContacts(makeDb(seed()), { actor: 'u1' })
ok(!noTarget2.ok && noTarget2.error === 'no_target', 'no ids + no filter → no_target')

console.log('contact-deletion — purgeContacts dryRun previews without deleting')
const dbA = makeDb(seed())
const dry = await purgeContacts(dbA, { filter: { source: 'winback_life' }, actor: 'u1', dryRun: true })
ok(dry.ok && dry.count === 2 && dry.deleted === 0, 'dryRun returns count, deletes nothing')
ok(dbA.deleted.size === 0, 'nothing removed on dryRun')

console.log('contact-deletion — purgeContacts filter path hard-deletes')
const dbB = makeDb(seed())
const delF = await purgeContacts(dbB, { filter: { source: 'winback_life' }, actor: 'u1' })
ok(delF.ok && delF.deleted === 2, 'filter delete removes 2')
ok(dbB.deleted.has('a1') && dbB.deleted.has('a2') && !dbB.deleted.has('a3'), 'only the matching rows removed')

console.log('contact-deletion — purgeContacts selection path hard-deletes existing ids only')
const dbC = makeDb(seed())
const delS = await purgeContacts(dbC, { ids: ['a3', 'nope'], actor: 'u1' })
ok(delS.ok && delS.deleted === 1, 'selection delete drops the bogus id, removes the real one')
ok(dbC.deleted.has('a3') && dbC.deleted.size === 1, 'only a3 removed')

console.log(`\ncontact-deletion — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
