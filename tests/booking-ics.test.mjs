// Native booking — pure ICS builder proof (src/lib/booking/ics.ts). Compiles the DB-free
// module in isolation and asserts the RFC 5545 basics the "add to calendar" action relies
// on: UTC timestamp format, text escaping, and a well-formed single-event VCALENDAR.
// Run: node tests/booking-ics.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-ics-'))
execSync(
  `npx tsc src/lib/booking/ics.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { buildIcs, toIcsUtc, escapeIcsText } = require(join(out, 'ics.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('toIcsUtc renders the RFC 5545 basic UTC format', () => {
  assert.equal(toIcsUtc('2026-08-03T14:00:00Z'), '20260803T140000Z')
  assert.equal(toIcsUtc('2026-08-03T14:05:09.000Z'), '20260803T140509Z')
})
t('toIcsUtc throws on an invalid timestamp', () => {
  assert.throws(() => toIcsUtc('not-a-date'))
})
t('escapeIcsText escapes backslash, comma, semicolon, and newline', () => {
  assert.equal(escapeIcsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne')
})
t('buildIcs produces a well-formed single-event VCALENDAR with CRLF', () => {
  const ics = buildIcs({
    uid: 'FFS-ABC123@fsos',
    title: 'Intro call',
    description: 'A quick chat, with detail',
    startsAt: '2026-08-03T14:00:00Z',
    endsAt: '2026-08-03T14:30:00Z',
  })
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(ics.includes('\r\nEND:VCALENDAR'))
  assert.ok(ics.includes('BEGIN:VEVENT'))
  assert.ok(ics.includes('UID:FFS-ABC123@fsos'))
  assert.ok(ics.includes('DTSTART:20260803T140000Z'))
  assert.ok(ics.includes('DTEND:20260803T143000Z'))
  assert.ok(ics.includes('SUMMARY:Intro call'))
  assert.ok(ics.includes('DESCRIPTION:A quick chat\\, with detail')) // comma escaped
  // DTSTAMP defaults to startsAt for determinism.
  assert.ok(ics.includes('DTSTAMP:20260803T140000Z'))
})
t('buildIcs omits optional fields when absent', () => {
  const ics = buildIcs({ uid: 'u', title: 't', startsAt: '2026-08-03T14:00:00Z', endsAt: '2026-08-03T14:30:00Z' })
  assert.equal(ics.includes('DESCRIPTION:'), false)
  assert.equal(ics.includes('LOCATION:'), false)
})

console.log(`\nAll ${passed} assertions passed.`)
