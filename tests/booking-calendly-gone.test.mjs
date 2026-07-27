// Native booking — Calendly decommission guardrail (Slice 8, ADR-027 §8). Proves the third-
// party scheduler is gone from the shipped product: no calendly.com URL, no CALENDLY_* env
// reference, and the inbound webhook route/handler removed. Booking is now fully native.
// (Historical mentions of the word "Calendly" in explanatory comments — e.g. "Calendly
// replacement" — are allowed; only live URLs/env/routes are forbidden.)
// Run: node tests/booking-calendly-gone.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// Walk shipped application code + the env template.
const roots = ['src']
const exts = new Set(['.ts', '.tsx', '.js', '.jsx'])
const files = []
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue
      walk(p)
    } else if (exts.has(p.slice(p.lastIndexOf('.')))) {
      files.push(p)
    }
  }
}
for (const r of roots) if (existsSync(r)) walk(r)
if (existsSync('.env.local.example')) files.push('.env.local.example')

// Forbidden LIVE references (the verbatim decommission requirement: no calendly.com / CALENDLY_*).
const FORBIDDEN = [
  { re: /calendly\.com/i, label: 'calendly.com URL' },
  { re: /CALENDLY_/, label: 'CALENDLY_* env var' },
  { re: /NEXT_PUBLIC_CALENDLY/, label: 'NEXT_PUBLIC_CALENDLY env var' },
  { re: /webhooks\/calendly/i, label: 'Calendly webhook route path' },
  { re: /calendly-webhook-signature/i, label: 'Calendly webhook signature header' },
]

t('scanned a non-trivial set of shipped files', () => {
  assert.ok(files.length > 50, `expected to scan the app, found ${files.length} files`)
})

t('no live Calendly URL / env / webhook reference remains in shipped code', () => {
  const hits = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const { re, label } of FORBIDDEN) {
      if (re.test(src)) hits.push(`${f}: ${label}`)
    }
  }
  assert.deepEqual(hits, [], `forbidden Calendly references still present:\n${hits.join('\n')}`)
})

t('the inbound Calendly webhook route is deleted', () => {
  assert.equal(existsSync('src/app/api/webhooks/calendly'), false, 'the Calendly webhook directory must be removed')
})

t('bookingUrl() points at the native scheduler, not an external URL', () => {
  const site = readFileSync('src/lib/site.ts', 'utf8')
  assert.match(site, /export function bookingUrl\(\)[^}]*return '\/schedule'/s)
})

t('the decommission reconciliation migration exists (open bookings preserved)', () => {
  const migs = readdirSync('supabase/migrations').filter((f) => /calendly/i.test(f))
  assert.ok(migs.length >= 1, 'expected the 073 Calendly reconciliation migration')
  const sql = readFileSync(join('supabase/migrations', migs[0]), 'utf8')
  assert.match(sql, /legacy_calendly/) // migrated rows carry the provenance flag
  assert.match(sql, /booked_via/)
})

console.log(`\nAll ${passed} assertions passed.`)
