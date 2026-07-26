// Native booking — start_url exposure guardrail (spec §5 / §9). The Zoom HOST link
// (start_url) is FSA-only: it must be PERSISTED on the appointment but NEVER returned to a
// client or written to a log. This source-scan proves that invariant across the client-facing
// booking path, so a future edit that leaks the host link fails the build.
// Run: node tests/booking-starturl-firewall.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const book = readFileSync('src/lib/booking/book.ts', 'utf8')
const publicRoute = readFileSync('src/app/api/public/booking/route.ts', 'utf8')
const flow = readFileSync('src/components/public/booking/BookingFlow.tsx', 'utf8')
const provisionRoute = readFileSync('src/app/api/app/booking/provision-zoom/route.ts', 'utf8')

t('book.ts persists start_url to the DB (host link is stored)', () => {
  assert.match(book, /start_url:\s*meeting\.startUrl/)
})

t('the confirmation object returned to the client contains NO start link', () => {
  // Isolate the `confirmation: { … }` literal that book.ts returns to the caller.
  const idx = book.indexOf('confirmation: {')
  assert.ok(idx > -1, 'confirmation literal found')
  const block = book.slice(idx, book.indexOf('}', idx) + 1)
  assert.equal(/start_url|startUrl/.test(block), false, 'confirmation must not carry the host link')
  // And it DOES carry the attendee join link.
  assert.match(block, /joinUrl/)
})

t('book.ts never logs the host link', () => {
  for (const line of book.split('\n')) {
    if (/console\./.test(line)) {
      assert.equal(/start_url|startUrl/.test(line), false, `console line leaks host link: ${line.trim()}`)
    }
  }
})

t('the public booking route never references the host link', () => {
  assert.equal(/start_url|startUrl/.test(publicRoute), false)
})

t('the public booking UI never references the host link', () => {
  assert.equal(/start_url|startUrl/.test(flow), false)
})

t('the FSA provision-zoom retry stores but never returns the host link', () => {
  assert.match(provisionRoute, /start_url:\s*meeting\.startUrl/) // stored
  // The JSON response(s) must not include the host link.
  for (const m of provisionRoute.matchAll(/NextResponse\.json\(([^;]*?)\)/gs)) {
    assert.equal(/start_url|startUrl/.test(m[1]), false, 'provision-zoom response leaks host link')
  }
})

console.log(`\nAll ${passed} assertions passed.`)
