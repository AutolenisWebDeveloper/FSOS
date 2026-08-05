// AI Communications Center — sub-navigation gate (Slice 9A).
//
// Compiles the PURE subnav config and asserts the grouping, that every comms route is
// reachable from within the hub (no orphans), and that active-state resolution behaves
// at the two boundaries that actually bite: the campaign list must not swallow its own
// /new sibling, and it must still highlight for a campaigns/[id] detail.
//
// Also covers the two-tier restructure: `activeSubnavGroup` is what decides which
// second-tier row renders, so a route that resolves to no group would silently lose
// its sub-navigation.
//
// Run: node tests/comms-subnav.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-comms-subnav-'))
execSync(
  `npx tsc src/lib/comms/subnav.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const { COMMS_OVERVIEW_HREF, COMMS_SUBNAV_GROUPS, isSubnavItemActive, activeSubnavGroup } = require(
  join(out, 'lib/comms/subnav.js'),
)

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const hrefs = COMMS_SUBNAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))
const groupOf = (label) => COMMS_SUBNAV_GROUPS.find((g) => g.label === label)

console.log('comms-subnav — structure')

t('the overview href is the comms hub root', () => {
  assert.equal(COMMS_OVERVIEW_HREF, '/app/comms')
})

t('the mandated groups exist in Slice 9 order', () => {
  assert.deepEqual(
    COMMS_SUBNAV_GROUPS.map((g) => g.label),
    ['Campaigns', 'Conversations', 'Templates', 'Governance', 'Insight'],
  )
})

t('every group has at least one destination', () => {
  for (const g of COMMS_SUBNAV_GROUPS) {
    assert.ok(g.items.length > 0, `${g.label} has no destinations`)
  }
})

t('the governance group keeps all four compliance surfaces', () => {
  // These are the surfaces that evidence consent/DNC/ownership handling. Losing one
  // from the nav effectively hides a compliance control from the advisor.
  const governance = groupOf('Governance').items.map((i) => i.href)
  for (const href of [
    '/app/comms/consent',
    '/app/comms/suppression',
    '/app/comms/assignments',
    '/app/comms/identity',
  ]) {
    assert.ok(governance.includes(href), `${href} dropped out of Governance`)
  }
})

t('no href is listed twice', () => {
  assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate destination in the subnav')
})

console.log('comms-subnav — no orphaned routes')

t('every comms page route is reachable from the hub', () => {
  // Walk the real route tree so a newly added surface fails here rather than
  // shipping unreachable. Detail ([id]) and non-page files are reached from their
  // list page, so they are not required to appear.
  const root = 'src/app/(fsa)/app/comms'
  const routes = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('[')) continue // dynamic detail route
      const next = join(dir, entry.name)
      const href = `${prefix}/${entry.name}`
      if (existsSync(join(next, 'page.tsx'))) routes.push(href)
      walk(next, href)
    }
  }
  walk(root, '/app/comms')

  const missing = routes.filter((r) => !hrefs.includes(r))
  assert.deepEqual(missing, [], `unreachable comms routes: ${missing.join(', ')}`)
})

t('every subnav href points at a route that exists', () => {
  const dead = hrefs.filter((h) => {
    const rel = h.replace('/app/comms', 'src/app/(fsa)/app/comms')
    return !existsSync(join(rel, 'page.tsx'))
  })
  assert.deepEqual(dead, [], `subnav links to non-existent routes: ${dead.join(', ')}`)
})

console.log('comms-subnav — active state')

t('an exact route is active', () => {
  assert.equal(isSubnavItemActive('/app/comms/inbox', '/app/comms/inbox'), true)
})

t('a detail route highlights its parent list', () => {
  assert.equal(isSubnavItemActive('/app/comms/inbox', '/app/comms/inbox/abc-123'), true)
  assert.equal(isSubnavItemActive('/app/comms/campaigns', '/app/comms/campaigns/abc-123'), true)
})

t('the campaign list does NOT swallow its own /new sibling', () => {
  assert.equal(isSubnavItemActive('/app/comms/campaigns', '/app/comms/campaigns/new'), false)
  assert.equal(isSubnavItemActive('/app/comms/campaigns/new', '/app/comms/campaigns/new'), true)
})

t('a sibling route does not light up an unrelated item', () => {
  assert.equal(isSubnavItemActive('/app/comms/sms', '/app/comms/email'), false)
  assert.equal(isSubnavItemActive('/app/comms/consent', '/app/comms/suppression'), false)
})

t('the overview does not light up every child route', () => {
  // Every comms route starts with /app/comms, so the overview must match exactly.
  assert.notEqual(COMMS_OVERVIEW_HREF, hrefs[0])
  assert.ok(hrefs.every((h) => h !== COMMS_OVERVIEW_HREF))
})

console.log('comms-subnav — two-tier group resolution')

t('every destination resolves to its own group', () => {
  for (const g of COMMS_SUBNAV_GROUPS) {
    for (const item of g.items) {
      const resolved = activeSubnavGroup(item.href)
      assert.ok(resolved, `${item.href} resolves to no group — it would lose its second tier`)
      assert.equal(resolved.label, g.label, `${item.href} resolved to ${resolved.label}, expected ${g.label}`)
    }
  }
})

t('a detail route keeps its parent group (second tier stays visible)', () => {
  assert.equal(activeSubnavGroup('/app/comms/inbox/abc-123').label, 'Conversations')
  assert.equal(activeSubnavGroup('/app/comms/campaigns/abc-123').label, 'Campaigns')
  assert.equal(activeSubnavGroup('/app/comms/templates/abc-123').label, 'Templates')
})

t('campaigns/new resolves to Campaigns, not to nothing', () => {
  // It is excluded from the LIST item's active state but must still select the group,
  // otherwise creating a campaign drops the whole second tier.
  assert.equal(activeSubnavGroup('/app/comms/campaigns/new').label, 'Campaigns')
})

t('the overview itself belongs to no group', () => {
  assert.equal(activeSubnavGroup(COMMS_OVERVIEW_HREF), null)
})

console.log(`\n${passed} assertions passed`)
