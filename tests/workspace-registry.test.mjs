// Guardrail — Workspace Registry invariants (docs/redesign/security-audit-slice1.md §4).
// The Advisor OS navigation layer must never let a workspace's declared portal
// drift from the URL-prefix authorization, link across a portal boundary, point
// at a route that does not exist, or drop a destination the current sidebar reaches.
// These are the four invariants that keep "workspaces are presentation only" TRUE.
//
// Run: node tests/workspace-registry.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readdirSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-ws-'))
// Both modules are self-contained (no local runtime imports), so single-file
// transpile works exactly like the auth-matrix test transpiles rbac.ts.
execSync(
  `npx tsc src/lib/auth/rbac.ts src/lib/workspaces/registry.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { portalOf } = require(join(out, 'auth/rbac.js'))
const { WORKSPACES, PORTAL_HOME, activeWorkspace } = require(join(out, 'workspaces/registry.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Workspace Registry invariants')

// ── Build the set of REAL routes from the filesystem (route groups stripped) ──
// A registry href is valid if it matches a static route, or a dynamic route with
// [seg] treated as a single-segment wildcard (e.g. /admin/config/general matches
// /admin/config/[section]).
function collectRoutes(dir, segs, routes) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (!statSync(full).isDirectory()) continue
    if (entry === 'api') continue
    // Strip route-group segments like (fsa).
    const nextSegs = entry.startsWith('(') && entry.endsWith(')') ? segs : [...segs, entry]
    if (existsSync(join(full, 'page.tsx'))) {
      routes.push('/' + nextSegs.join('/'))
    }
    collectRoutes(full, nextSegs, routes)
  }
}
const REAL_ROUTES = []
collectRoutes('src/app', [], REAL_ROUTES)
const routeMatchers = REAL_ROUTES.map((r) => ({
  raw: r,
  parts: r === '/' ? [''] : r.slice(1).split('/'),
}))
function routeExists(href) {
  const parts = href === '/' ? [''] : href.slice(1).split('/')
  return routeMatchers.some(
    (m) =>
      m.parts.length === parts.length &&
      m.parts.every((seg, i) => (seg.startsWith('[') && seg.endsWith(']')) || seg === parts[i]),
  )
}

const PORTALS = ['fsa', 'admin', 'compliance', 'partner', 'client', 'super']

// ── Invariant 1: portal consistency — declared portal === enforced portal ─────
t('registry-portal-consistency: portalOf(home) === workspace.portal', () => {
  for (const w of WORKSPACES) {
    assert.equal(portalOf(w.home), w.portal, `${w.id}: home ${w.home} routes to ${portalOf(w.home)} not ${w.portal}`)
  }
})

t('registry-portal-consistency: every match prefix and nav href stays in-portal', () => {
  for (const w of WORKSPACES) {
    for (const p of w.match) {
      assert.equal(portalOf(p), w.portal, `${w.id}: match ${p} → ${portalOf(p)} ≠ ${w.portal}`)
    }
    for (const item of w.nav) {
      assert.equal(portalOf(item.href), w.portal, `${w.id}: nav ${item.href} → ${portalOf(item.href)} ≠ ${w.portal}`)
    }
  }
})

// ── Invariant 2: every registry route exists on disk ──────────────────────────
t('registry-routes-exist: every home and nav href resolves to a real page.tsx', () => {
  for (const w of WORKSPACES) {
    assert.ok(routeExists(w.home), `${w.id}: home ${w.home} has no page`)
    for (const item of w.nav) {
      assert.ok(routeExists(item.href), `${w.id}: nav ${item.href} has no page`)
    }
  }
})

// ── Invariant 3: registry covers the legacy FSA sidebar (nothing dropped) ──────
// Sourced from src/app/(fsa)/layout.tsx NAV at the time of the redesign. Each must
// be owned by a workspace via a SPECIFIC prefix (not merely the '/app' fallback).
const LEGACY_FSA_NAV = [
  '/app', '/app/dashboards', '/app/forecasts', '/app/executive/briefing', '/app/ai/workforce',
  '/app/fna', '/app/comms', '/app/social', '/app/revenue', '/app/notifications',
  '/app/cross-sell', '/app/winback', '/app/conversions',
  '/app/agencies', '/app/contacts', '/app/referrals', '/app/households', '/app/policies',
  '/app/book/import', '/app/crosssell', '/app/winback/import', '/app/conversions/import', '/app/contacts/review',
  '/app/reviews', '/app/opportunities', '/app/opra', '/app/cases', '/app/commissions',
  '/app/comms/inbox', '/app/knowledge', '/app/contacts/upload', '/app/forms', '/app/workshops',
  '/app/workshops/review', '/app/documents', '/app/workflows', '/app/tasks', '/app/calendar',
  '/app/booking', '/app/tools/calculator', '/app/ai', '/app/ai/escalations', '/app/assistant',
  '/app/compliance', '/app/reports', '/app/contacts/ffs',
  '/app/settings', '/app/help',
]
function coveredSpecifically(href) {
  if (href === '/app') return true
  return WORKSPACES.some(
    (w) => w.portal === 'fsa' && w.match.some((p) => p !== '/app' && (href === p || href.startsWith(p + '/'))),
  )
}
t('registry-covers-legacy-nav: every legacy FSA destination has a dedicated workspace', () => {
  for (const href of LEGACY_FSA_NAV) {
    assert.ok(coveredSpecifically(href), `legacy nav ${href} is not covered by a specific workspace prefix`)
  }
})

// ── Invariant 3b: registry covers every migrated portal's legacy sidebar ──────
// Sourced from each portal's pre-redesign (portal)/layout.tsx NAV. Proves the
// fan-out dropped no destination and shifted no portal boundary: each legacy href
// is owned by a workspace IN THE SAME PORTAL via a specific (non-root) prefix.
const LEGACY_NAV = {
  admin: {
    root: '/admin',
    hrefs: ['/admin', '/admin/cases', '/admin/documents', '/admin/data/imports', '/admin/data/exports',
      '/admin/data/duplicates', '/admin/support/requests', '/admin/users'],
  },
  super: {
    root: '/super',
    hrefs: ['/super', '/super/users', '/super/roles', '/super/permissions', '/super/products',
      '/super/integrations', '/super/ai/policies', '/super/ai/sandbox', '/super/config/gdc-tiers',
      '/super/config/ffs-contacts', '/super/workflows', '/super/webhooks', '/super/jobs', '/super/states',
      '/super/audit', '/super/security', '/super/backups'],
  },
  compliance: {
    root: '/compliance',
    // '/compliance/firewall' was retired with the Compliance Firewall page removal
    // (ADR-041). The securities firewall GUARDRAIL is untouched; only the ledger
    // page is gone, and its evidence now reads from '/compliance/audit'.
    hrefs: ['/compliance', '/compliance/audit', '/compliance/communications', '/compliance/consent',
      '/compliance/incidents', '/compliance/licenses', '/compliance/legal-holds',
      '/compliance/attestations', '/compliance/policies'],
  },
  partner: {
    root: '/partner',
    hrefs: ['/partner', '/partner/production', '/partner/commissions', '/partner/refer', '/partner/referrals',
      '/partner/materials', '/partner/training', '/partner/schedule', '/partner/messages', '/partner/tasks',
      '/partner/settings'],
  },
  client: {
    root: '/client',
    hrefs: ['/client', '/client/schedule', '/client/appointments', '/client/intake', '/client/documents',
      '/client/reviews', '/client/case-status', '/client/education', '/client/preferences', '/client/consent'],
  },
}
function coveredInPortal(portal, href, root) {
  if (href === root) return true
  return WORKSPACES.some(
    (w) => w.portal === portal && w.match.some((p) => p !== root && (href === p || href.startsWith(p + '/'))),
  )
}
t('registry-covers-legacy-nav (all portals): no fan-out destination dropped', () => {
  for (const [portal, { root, hrefs }] of Object.entries(LEGACY_NAV)) {
    for (const href of hrefs) {
      assert.ok(coveredInPortal(portal, href, root), `${portal}: legacy ${href} not covered by a specific workspace prefix`)
      // And the boundary did not shift: it resolves to a workspace in the same portal.
      assert.equal(activeWorkspace(portal, href)?.portal, portal, `${portal}: ${href} resolves outside its portal`)
    }
  }
})

// ── Invariant 4: back-nav target stays in-portal (no cross-portal '/app' link) ─
t('backnav-same-portal: PORTAL_HOME[portal] routes to that same portal', () => {
  for (const portal of PORTALS) {
    assert.ok(PORTAL_HOME[portal], `no PORTAL_HOME for ${portal}`)
    assert.equal(portalOf(PORTAL_HOME[portal]), portal, `back-nav ${PORTAL_HOME[portal]} leaves portal ${portal}`)
  }
})

// ── Resolution sanity — the longest-prefix rule behaves ───────────────────────
t('activeWorkspace: longest-prefix resolution (nested + fallback)', () => {
  assert.equal(activeWorkspace('fsa', '/app').id, 'executive')
  assert.equal(activeWorkspace('fsa', '/app/unknown-future-route').id, 'executive') // '/app' fallback
  assert.equal(activeWorkspace('fsa', '/app/households/abc').id, 'households')
  assert.equal(activeWorkspace('fsa', '/app/comms/campaigns').id, 'communications')
  assert.equal(activeWorkspace('fsa', '/app/comms/inbox/xyz').id, 'inbox') // longer prefix wins over comms
  assert.equal(activeWorkspace('fsa', '/app/opra/eligible').id, 'opportunities')
  assert.equal(activeWorkspace('super', '/super/ai/policies').id, 'super-ai')
})

// ── Every portal has at least one workspace whose home IS the portal root ──────
t('each portal has a landing workspace at the portal root', () => {
  for (const portal of PORTALS) {
    const list = WORKSPACES.filter((w) => w.portal === portal)
    assert.ok(list.length > 0, `no workspaces for ${portal}`)
    assert.ok(list.some((w) => w.home === PORTAL_HOME[portal]), `${portal} has no workspace at its root`)
  }
})

console.log(`\nWorkspace Registry: ${passed} invariant groups passed.`)
