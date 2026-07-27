// Native booking — Google Calendar OAuth core proof (src/lib/booking/google/oauth.ts).
// Compiles the PURE module in isolation and asserts:
//   • the ONLY scope requested is calendar.readonly (read-only / one-way guarantee),
//   • the authorize URL carries offline access + forced consent (refresh token issuance),
//   • signed state round-trips and rejects expiry / tamper / wrong-key / cross-kind replay,
//   • the credential envelope serializes/parses and drives refresh-before-use,
//   • the freeBusy response mapper normalizes RFC3339 → UTC ISO and skips malformed rows.
// Run: node tests/booking-google-oauth.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-gcal-oauth-'))
execSync(
  `npx tsc src/lib/booking/google/oauth.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const m = require(join(out, 'oauth.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const KEY = 'gcal-test-key'
const NOW = 1_800_000_000_000

t('the ONLY requested scope is calendar.readonly (one-way, read-only)', () => {
  assert.equal(m.CALENDAR_READONLY_SCOPE, 'https://www.googleapis.com/auth/calendar.readonly')
  const cfg = m.calendarProviderConfig({ GOOGLE_CALENDAR_CLIENT_ID: 'cid', GOOGLE_CALENDAR_CLIENT_SECRET: 'sec' })
  assert.deepEqual(cfg.scopes, ['https://www.googleapis.com/auth/calendar.readonly'])
  // No write scope anywhere in the module's scope surface.
  assert.doesNotMatch(cfg.scopes.join(' '), /calendar(\.events)?($|[^.])/)
})

t('provider config gates on BOTH client id and secret', () => {
  assert.equal(m.googleCalendarConfigured({}), false)
  assert.equal(m.googleCalendarConfigured({ GOOGLE_CALENDAR_CLIENT_ID: 'cid' }), false)
  assert.equal(m.googleCalendarConfigured({ GOOGLE_CALENDAR_CLIENT_ID: 'cid', GOOGLE_CALENDAR_CLIENT_SECRET: 'sec' }), true)
  // Generic Google fallback env also works.
  assert.equal(m.googleCalendarConfigured({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' }), true)
})

t('authorize URL requests offline access + consent (refresh token issuance)', () => {
  const cfg = m.calendarProviderConfig({ GOOGLE_CALENDAR_CLIENT_ID: 'cid', GOOGLE_CALENDAR_CLIENT_SECRET: 'sec' })
  const url = new URL(m.buildAuthorizeUrl({ config: cfg, redirectUri: 'https://x/cb', state: 'st' }))
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.readonly')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('prompt'), 'consent')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://x/cb')
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
})

t('signed state round-trips to its nonce + kind', () => {
  const tok = m.signState({ kind: 'booking_calendar', nonce: 'n1', exp: NOW + 1000 }, KEY)
  const v = m.verifyState(tok, KEY, NOW)
  assert.equal(v.nonce, 'n1')
  assert.equal(v.kind, 'booking_calendar')
})

t('rejects expired / wrong-key / tampered / malformed state', () => {
  assert.equal(m.verifyState(m.signState({ kind: 'booking_calendar', nonce: 'n', exp: NOW - 1 }, KEY), KEY, NOW), null)
  assert.equal(m.verifyState(m.signState({ kind: 'booking_calendar', nonce: 'n', exp: NOW + 1000 }, 'other'), KEY, NOW), null)
  const good = m.signState({ kind: 'booking_calendar', nonce: 'n', exp: NOW + 1000 }, KEY)
  const [p] = good.split('.')
  assert.equal(m.verifyState(`${p}.deadbeef`, KEY, NOW), null)
  assert.equal(m.verifyState('no-dot', KEY, NOW), null)
  assert.equal(m.verifyState('', KEY, NOW), null)
})

t('rejects a state of a different kind (no cross-context replay)', () => {
  // A payload whose kind isn't booking_calendar must not verify even if signed with our key.
  const payload = Buffer.from(JSON.stringify({ kind: 'social', nonce: 'n', exp: NOW + 1000 })).toString('base64url')
  const crypto = require('node:crypto')
  const sig = crypto.createHmac('sha256', KEY).update(payload).digest('base64url')
  assert.equal(m.verifyState(`${payload}.${sig}`, KEY, NOW), null)
})

t('credential envelope serializes and parses (JSON only)', () => {
  const env = { accessToken: 'AT', refreshToken: 'RT', expiresAt: '2026-01-01T00:00:00.000Z', tokenType: 'Bearer' }
  const parsed = m.parseCredential(m.serializeCredential(env))
  assert.deepEqual(parsed, env)
  assert.equal(m.parseCredential('not-json'), null)
  assert.equal(m.parseCredential(''), null)
  assert.equal(m.parseCredential(null), null)
})

t('credentialNeedsRefresh honors expiry + skew', () => {
  assert.equal(m.credentialNeedsRefresh(null, NOW), false)
  assert.equal(m.credentialNeedsRefresh({ accessToken: 'x' }, NOW), false) // no expiry → assume long-lived
  assert.equal(m.credentialNeedsRefresh({ accessToken: 'x', expiresAt: new Date(NOW + 10 * 60_000).toISOString() }, NOW), false)
  assert.equal(m.credentialNeedsRefresh({ accessToken: 'x', expiresAt: new Date(NOW + 60_000).toISOString() }, NOW), true) // within 120s skew
  assert.equal(m.credentialNeedsRefresh({ accessToken: 'x', expiresAt: new Date(NOW - 1).toISOString() }, NOW), true)
})

t('redirect URI points at the booking callback (not the social one)', () => {
  assert.equal(m.calendarRedirectUri('https://app.example.com'), 'https://app.example.com/api/app/booking/calendar/oauth/callback')
  assert.equal(m.calendarRedirectUri('https://app.example.com/'), 'https://app.example.com/api/app/booking/calendar/oauth/callback')
})

t('freeBusy mapper normalizes RFC3339 → UTC ISO for the target calendar', () => {
  const json = {
    calendars: {
      primary: {
        busy: [
          { start: '2026-08-10T09:00:00-05:00', end: '2026-08-10T10:00:00-05:00' },
          { start: '2026-08-10T13:00:00Z', end: '2026-08-10T13:30:00Z' },
        ],
      },
      other: { busy: [{ start: '2026-08-10T20:00:00Z', end: '2026-08-10T21:00:00Z' }] },
    },
  }
  const busy = m.mapFreeBusyResponse(json, 'primary')
  assert.equal(busy.length, 2)
  assert.deepEqual(busy[0], { startsAt: '2026-08-10T14:00:00.000Z', endsAt: '2026-08-10T15:00:00.000Z' }) // -05:00 → UTC
  assert.deepEqual(busy[1], { startsAt: '2026-08-10T13:00:00.000Z', endsAt: '2026-08-10T13:30:00.000Z' })
})

t('freeBusy mapper skips malformed / inverted / missing rows and never throws', () => {
  assert.deepEqual(m.mapFreeBusyResponse(null, 'primary'), [])
  assert.deepEqual(m.mapFreeBusyResponse({}, 'primary'), [])
  assert.deepEqual(m.mapFreeBusyResponse({ calendars: { primary: {} } }, 'primary'), [])
  const bad = {
    calendars: {
      primary: {
        busy: [
          { start: 'not-a-date', end: '2026-08-10T10:00:00Z' },
          { start: '2026-08-10T10:00:00Z' }, // missing end
          { start: '2026-08-10T11:00:00Z', end: '2026-08-10T10:00:00Z' }, // end <= start
          { start: '2026-08-10T12:00:00Z', end: '2026-08-10T12:30:00Z' }, // the one good row
        ],
      },
    },
  }
  const busy = m.mapFreeBusyResponse(bad, 'primary')
  assert.equal(busy.length, 1)
  assert.deepEqual(busy[0], { startsAt: '2026-08-10T12:00:00.000Z', endsAt: '2026-08-10T12:30:00.000Z' })
})

console.log(`\nAll ${passed} assertions passed.`)
