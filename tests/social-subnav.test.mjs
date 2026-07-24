// AI Social Media Center — sub-navigation gate (ADR-026).
//
// Compiles the PURE subnav config and asserts the grouping mandated by the build
// instruction (Content · Publishing · Engagement · Insight · Setup), that every
// social route is reachable from within the hub (no orphaned Calendar / Accounts),
// and that active-state resolution does not let the content list swallow /new while
// still highlighting for a content/[id] detail route.

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-subnav-'))
execSync(
  `npx tsc src/lib/social/subnav.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const subnav = require(join(out, 'lib/social/subnav.js'))
const { SOCIAL_OVERVIEW_HREF, SOCIAL_SUBNAV_GROUPS, isSubnavItemActive } = subnav

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const groupOf = (label) => SOCIAL_SUBNAV_GROUPS.find((g) => g.label === label)
const hrefs = SOCIAL_SUBNAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))

t('the overview href is the social hub root', () => {
  assert.equal(SOCIAL_OVERVIEW_HREF, '/app/social')
})

t('the five mandated groups exist in order', () => {
  assert.deepEqual(
    SOCIAL_SUBNAV_GROUPS.map((g) => g.label),
    ['Content', 'Publishing', 'Engagement', 'Insight', 'Setup'],
  )
})

t('Content groups content + new + media', () => {
  const items = groupOf('Content').items.map((i) => i.href)
  assert.ok(items.includes('/app/social/content'))
  assert.ok(items.includes('/app/social/content/new'))
  assert.ok(items.includes('/app/social/media'))
})

t('Publishing groups calendar + queue', () => {
  const items = groupOf('Publishing').items.map((i) => i.href)
  assert.deepEqual(items.sort(), ['/app/social/calendar', '/app/social/queue'])
})

t('Engagement, Insight, Setup route to engagement / analytics / accounts', () => {
  assert.deepEqual(groupOf('Engagement').items.map((i) => i.href), ['/app/social/engagement'])
  assert.deepEqual(groupOf('Insight').items.map((i) => i.href), ['/app/social/analytics'])
  assert.deepEqual(groupOf('Setup').items.map((i) => i.href), ['/app/social/accounts'])
})

t('every social surface is reachable from the sub-nav (no orphans)', () => {
  for (const href of [
    '/app/social/content',
    '/app/social/content/new',
    '/app/social/media',
    '/app/social/calendar',
    '/app/social/queue',
    '/app/social/engagement',
    '/app/social/analytics',
    '/app/social/accounts',
  ]) {
    assert.ok(hrefs.includes(href), `${href} must be reachable from the sub-nav`)
  }
})

t('the content list highlights for a content/[id] detail but not for /new', () => {
  assert.equal(isSubnavItemActive('/app/social/content', '/app/social/content'), true)
  assert.equal(isSubnavItemActive('/app/social/content', '/app/social/content/abc-123'), true)
  assert.equal(isSubnavItemActive('/app/social/content', '/app/social/content/new'), false)
  assert.equal(isSubnavItemActive('/app/social/content/new', '/app/social/content/new'), true)
})

t('a sibling route does not light up an unrelated item', () => {
  assert.equal(isSubnavItemActive('/app/social/queue', '/app/social/calendar'), false)
  assert.equal(isSubnavItemActive('/app/social/analytics', '/app/social/analytics'), true)
})

console.log(`\nSocial Subnav: ${passed} assertions passed.`)
