// Compliance Firewall PAGE removal — the standing regression guard (ADR-041).
//
// The word "firewall" names four different things in this repo, and only ONE was
// removed. This file pins that distinction so a future change cannot quietly take
// the wrong one:
//
//   REMOVED  — the two read-only ledger PAGES over `compliance_events`
//              (/app/compliance/firewall and /compliance/firewall).
//   RETAINED — the securities firewall GUARDRAIL (src/lib/compliance/firewall.ts),
//              Guardrail 1, enforced at every write boundary. ADR-004 mandates this
//              control; it never mandated a page.
//   RETAINED — the `compliance_events` audit ledger and every writer to it, plus the
//              `firewall.blocked` / `comms.blocked` audit actions.
//   RETAINED — the surviving read surfaces that carry the same evidence:
//              /app/executive/alerts (FSA) and /compliance/audit (supervisor).
//
// Deleting the guardrail, silencing an audit writer, or re-introducing a dangling
// link to a removed route all fail here.
//
// Run: node tests/compliance-firewall-page-removed.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const has = (p) => existsSync(join(root, p))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Compliance Firewall page removal (ADR-041)')

// ── 1. The pages are gone — a natural 404, no redirect or placeholder ─────────
const REMOVED_PAGES = [
  'src/app/(fsa)/app/compliance/firewall/page.tsx',
  'src/app/(fsa)/app/compliance/firewall/loading.tsx',
  'src/app/(compliance)/compliance/firewall/page.tsx',
]
t('both firewall ledger pages (and the FSA loading state) are deleted', () => {
  for (const p of REMOVED_PAGES) assert.ok(!has(p), `${p} still exists`)
  assert.ok(!has('src/app/(fsa)/app/compliance/firewall'), 'FSA firewall route dir still exists')
  assert.ok(!has('src/app/(compliance)/compliance/firewall'), 'compliance firewall route dir still exists')
})

t('no redirect, rewrite, or placeholder was left behind for either route', () => {
  for (const f of ['next.config.js', 'src/middleware.ts', 'vercel.json']) {
    assert.ok(!/compliance\/firewall/.test(read(f)), `${f} still references a firewall route`)
  }
})

// ── 2. Nothing links to a route that no longer exists ────────────────────────
// Route references only: `@/lib/compliance/firewall` (the guardrail import) is a
// module specifier, not a URL, and must survive — so match a leading slash.
t('no source file links to /app/compliance/firewall or /compliance/firewall', () => {
  const hits = execSync(
    `grep -rn "['\\"\\\`]/\\(app/\\)\\?compliance/firewall" src/ || true`,
    { cwd: root, encoding: 'utf8' },
  ).trim()
  assert.equal(hits, '', `dangling link(s) to a removed route:\n${hits}`)
})

// ── 3. The workspace registry has no dangling href or match prefix ───────────
const out = mkdtempSync(join(tmpdir(), 'fsos-fw-'))
execSync(
  `npx tsc src/lib/workspaces/registry.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { cwd: root, stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { WORKSPACES } = require(join(out, 'registry.js'))

t('no workspace nav href, home, or match prefix points at a firewall route', () => {
  for (const w of WORKSPACES) {
    assert.ok(!/firewall/i.test(w.home), `${w.id}: home ${w.home}`)
    for (const p of w.match) assert.ok(!/firewall/i.test(p), `${w.id}: match ${p}`)
    for (const item of w.nav) assert.ok(!/firewall/i.test(item.href), `${w.id}: nav ${item.href}`)
  }
})

t('no workspace label or description still advertises the removed page', () => {
  for (const w of WORKSPACES) {
    assert.ok(!/firewall/i.test(w.label), `${w.id}: label "${w.label}"`)
    assert.ok(!/firewall/i.test(w.description), `${w.id}: description "${w.description}"`)
  }
})

// ── 4. THE GUARDRAIL SURVIVED — this is the control ADR-004 actually mandates ─
t('src/lib/compliance/firewall.ts still exports the full guardrail API', () => {
  assert.ok(has('src/lib/compliance/firewall.ts'), 'the securities firewall guardrail was deleted')
  const src = read('src/lib/compliance/firewall.ts')
  for (const sym of [
    'SECURITIES_FORBIDDEN_FIELD_PATTERNS',
    'class FirewallError',
    'function findForbiddenSecuritiesFields',
    'function assertNotSecuritiesSystemOfRecord',
    'function isSecurity',
  ]) {
    assert.ok(src.includes(sym), `guardrail export missing: ${sym}`)
  }
})

// The write boundaries that must keep calling it. Losing one of these silently
// would make FSOS a securities system of record — the exact failure ADR-004 exists
// to prevent, and the reason the page removal must not touch this module.
const GUARDED_WRITE_ROUTES = [
  'src/app/api/cases/route.ts',
  'src/app/api/commissions/[id]/route.ts',
  'src/app/api/commissions/splits/route.ts',
  'src/app/api/opportunities/route.ts',
  'src/app/api/policies/route.ts',
  'src/app/api/referrals/[id]/convert/route.ts',
  'src/app/api/reviews/[id]/outcome/route.ts',
  'src/app/api/social/content/route.ts',
]
t('every guarded write route still imports and calls the securities firewall', () => {
  for (const p of GUARDED_WRITE_ROUTES) {
    const src = read(p)
    assert.match(src, /from '@\/lib\/compliance\/firewall'/, `${p}: guardrail import removed`)
    assert.match(src, /assertNotSecuritiesSystemOfRecord\(/, `${p}: guardrail no longer called`)
  }
})

t('src/lib/social/precheck.ts still screens payloads through the guardrail', () => {
  const src = read('src/lib/social/precheck.ts')
  assert.match(src, /findForbiddenSecuritiesFields/, 'social precheck lost the securities screen')
})

// ── 5. The audit ledger survived — nothing stopped being recorded ────────────
t('firewall.blocked and comms.blocked remain in the audit taxonomy', () => {
  const src = read('src/lib/audit/log.ts')
  assert.match(src, /'firewall\.blocked'/, 'firewall.blocked dropped from AUDIT_ACTIONS')
  assert.match(src, /'comms\.blocked'/, 'comms.blocked dropped from AUDIT_ACTIONS')
})

t('the compliance_events writers are all still in place', () => {
  const writers = execSync(
    `grep -rln "from('compliance_events').insert" src/ || true`,
    { cwd: root, encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
  // 9 at the time of removal; the page was a READER and removing it changed none.
  assert.ok(writers.length >= 9, `expected ≥9 compliance_events writers, found ${writers.length}`)
  for (const required of [
    'src/lib/comms/escalation.ts',
    'src/app/api/opportunities/route.ts',
    'src/app/api/cases/route.ts',
  ]) {
    assert.ok(writers.includes(required), `compliance_events writer lost: ${required}`)
  }
})

// ── 6. The evidence is still readable in BOTH portals ────────────────────────
t('the surviving evidence surfaces exist and read the right sources', () => {
  const alerts = 'src/app/(fsa)/app/executive/alerts/page.tsx'
  assert.ok(has(alerts), 'FSA evidence surface /app/executive/alerts is missing')
  assert.match(read(alerts), /from\('compliance_events'\)/, 'alerts no longer reads compliance_events')

  const audit = 'src/app/(compliance)/compliance/audit/page.tsx'
  assert.ok(has(audit), 'supervisory evidence surface /compliance/audit is missing')
  assert.match(read(audit), /from\('audit_log'\)/, 'compliance audit no longer reads audit_log')
})

t('the other compliance surfaces were not collateral damage', () => {
  for (const p of [
    'src/app/(fsa)/app/compliance/page.tsx',
    'src/app/(fsa)/app/compliance/consent/page.tsx',
    'src/app/(fsa)/app/compliance/dnc/page.tsx',
    'src/app/(fsa)/app/compliance/licenses/page.tsx',
    'src/app/(compliance)/compliance/page.tsx',
    'src/app/(compliance)/compliance/consent/page.tsx',
    'src/app/(compliance)/compliance/licenses/page.tsx',
    'src/app/(compliance)/compliance/communications/page.tsx',
    'src/app/(compliance)/compliance/incidents/page.tsx',
    'src/app/(compliance)/compliance/attestations/page.tsx',
    'src/app/(compliance)/compliance/legal-holds/page.tsx',
    'src/app/(compliance)/compliance/policies/page.tsx',
  ]) {
    assert.ok(has(p), `unrelated compliance surface removed: ${p}`)
  }
})

// ── 6b. The route-inventory docs do not still advertise a live route ─────────
// The grep in §2 is a URL check scoped to src/ — by construction it cannot catch a
// docs file-tree entry or prose naming the feature. These two files are the route
// inventories that drift first, so they get an explicit assertion. Mentions that
// RECORD the removal (a strikethrough entry, the ADR note) are expected and allowed.
t('route-inventory docs no longer list the pages as live routes', () => {
  const routes = read('docs/routes.md')
  assert.ok(!/firewall\/page\.tsx/.test(routes), 'docs/routes.md still lists firewall/page.tsx')

  const matrix = read('docs/redesign/route-workspace-matrix.md')
  const liveRows = matrix
    .split('\n')
    .filter((l) => l.startsWith('|') && /compliance\/firewall/.test(l))
  assert.deepEqual(liveRows, [], `route-workspace-matrix still maps a firewall route:\n${liveRows.join('\n')}`)

  // Every sitemap mention must be struck through (recorded as removed), never live.
  for (const line of read('docs/sitemap.md').split('\n')) {
    if (!/compliance\/firewall/.test(line)) continue
    assert.match(line, /~~/, `docs/sitemap.md lists a firewall route as live:\n${line}`)
  }

  // The nav model lists sub-pages by LABEL, not path, so it needs a label check.
  const navModel = read('docs/redesign/slice2/section-map-and-nav-model.md')
  assert.ok(
    !/Securities Firewall/.test(navModel),
    'section-map-and-nav-model.md still lists Securities Firewall as a compliance sub-page',
  )
})

// ── 7. No migration was written — the ledger keeps every row (ADR-040 rule) ───
t('no migration drops or alters compliance_events', () => {
  const hits = execSync(
    `grep -rln "drop table.*compliance_events\\|DROP TABLE.*compliance_events" supabase/migrations/ || true`,
    { cwd: root, encoding: 'utf8' },
  ).trim()
  assert.equal(hits, '', `a migration drops compliance_events:\n${hits}`)
})

console.log(`\nAll ${passed} assertions passed.`)
