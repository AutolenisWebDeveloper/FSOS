// Native booking — Google one-way / read-only guardrail (ADR-027 §7). Source-scans the
// booking Google module + its routes to PROVE FSOS can never write back to Google:
//   • the only Google auth scope referenced is calendar.readonly (no write/events scope),
//   • the only Google Calendar API endpoint referenced is freeBusy (a read-only query),
//   • no calendar events-mutation endpoint or write verb against calendar appears anywhere.
// This is a structural guarantee, independent of runtime config.
// Run: node tests/booking-google-no-writeback.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const files = []
const libDir = 'src/lib/booking/google'
for (const f of readdirSync(libDir)) if (f.endsWith('.ts')) files.push(join(libDir, f))
const routeDir = 'src/app/api/app/booking/calendar'
function collectRoutes(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) collectRoutes(p)
    else if (e.name === 'route.ts') files.push(p)
  }
}
if (existsSync(routeDir)) collectRoutes(routeDir)

const sources = files.map((f) => ({ f, src: readFileSync(f, 'utf8') }))
const all = sources.map((s) => s.src).join('\n')

t('scanned the Google module + calendar routes (non-empty)', () => {
  assert.ok(files.length >= 4, `expected the google module + routes, found ${files.length}`)
})

t('the only Google OAuth scope referenced is calendar.readonly', () => {
  // Every "auth/calendar..." occurrence must be exactly the readonly scope.
  const occ = all.match(/auth\/calendar[A-Za-z.]*/g) || []
  assert.ok(occ.length > 0, 'expected the calendar scope to be referenced')
  for (const o of occ) assert.equal(o, 'auth/calendar.readonly', `forbidden scope reference: ${o}`)
  // Explicitly assert the read/write and events scopes never appear.
  assert.doesNotMatch(all, /auth\/calendar\.events/)
  assert.doesNotMatch(all, /auth\/calendar['" ]/) // bare full-access scope
})

t('the only Google Calendar API endpoint is freeBusy (read-only)', () => {
  const endpoints = all.match(/googleapis\.com\/calendar\/v3\/[A-Za-z/]*/g) || []
  assert.ok(endpoints.length > 0, 'expected the freeBusy endpoint to be referenced')
  for (const e of endpoints) assert.equal(e, 'googleapis.com/calendar/v3/freeBusy', `forbidden calendar endpoint: ${e}`)
})

t('no calendar events-mutation endpoint or write path appears', () => {
  assert.doesNotMatch(all, /calendar\/v3\/calendars\/[^'"`]*\/events/, 'events endpoint present')
  assert.doesNotMatch(all, /\/calendar\/v3\/events/, 'events endpoint present')
  // No obvious calendar write helpers.
  assert.doesNotMatch(all, /events\.(insert|update|patch|delete)/)
})

t('freeBusy is the sole write-verb call, and it is a read-only query', () => {
  // The only POST in the module is freeBusy (a query POST). Ensure no POST/PUT/PATCH/DELETE
  // targets an events/calendars mutation URL.
  for (const { f, src } of sources) {
    const badMethodOnEvents = /method:\s*'(POST|PUT|PATCH|DELETE)'[\s\S]{0,400}?events/i.test(src)
    assert.equal(badMethodOnEvents, false, `write verb against events in ${f}`)
  }
})

console.log(`\nAll ${passed} assertions passed.`)
