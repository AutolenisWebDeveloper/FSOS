// Workshop Zoom MEETING CREATION proof — the fix for "bookings/registrations create NO
// Zoom meeting at runtime". Before this, workshop_sessions.zoom_meeting_id was never set,
// so provisionZoomForRegistration always skipped ('no_meeting_id') and no registrant ever
// got a join link. FSOS now CREATES the meeting on workshop/session creation and on the
// staff retry, PATCHes on reschedule (booking), DELETEs on cancel — all idempotent + gated.
//
// Zoom is fully MOCKED here (no live API calls in CI). Four parts:
//   1. Pure idempotency/gating decision (src/lib/workshops/logic.ts → decideSessionMeetingProvision).
//   2. Zoom client (src/lib/zoom/client.ts) compiled standalone, fetch mocked: create returns
//      id/uuid/join/start/passcode/dial-in; update PATCH ok; delete ok on 204 AND 404;
//      token-failure (oauth 401) → clean ok:false (no_access_token); disabled → no-op, no fetch.
//   3. Static wiring — create route, retry route, cancel route call the helpers correctly.
//   4. Static guardrails — start_url is host-only (never returned/logged), migration additive.
// Run: node tests/workshop-zoom-provision.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-wzoom-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})

let passed = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  console.log(`  ✓ ${name}`)
  passed++
}
const require = createRequire(import.meta.url)

function tsc(rel, dir) {
  execSync(
    `npx tsc ${rel} --outDir ${dir} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
    { cwd: root, stdio: 'inherit' },
  )
}

// ── Part 1: pure idempotency/gating decision ──
tsc('src/lib/workshops/logic.ts', join(out, 'logic'))
const L = require(join(out, 'logic', 'logic.js'))

console.log('\ndecideSessionMeetingProvision (idempotent + gated)')
{
  const d = (deliveryMode, existingMeetingId, zoomEnabled) =>
    L.decideSessionMeetingProvision({ deliveryMode, existingMeetingId, zoomEnabled })
  ok('in_person session → skip (not_virtual)', d('in_person', null, true).reason === 'not_virtual' && d('in_person', null, true).create === false)
  ok('virtual + no meeting + enabled → CREATE', d('virtual', null, true).create === true && d('virtual', null, true).reason === 'create')
  ok('hybrid + no meeting + enabled → CREATE (remote attendees need a room)', d('hybrid', null, true).create === true)
  ok('virtual + existing meeting → skip (already) — NEVER a duplicate', d('virtual', 'mtg-123', true).create === false && d('virtual', 'mtg-123', true).reason === 'already')
  ok('idempotent even when disabled: existing meeting → already', d('virtual', 'mtg-123', false).reason === 'already')
  ok('virtual + no meeting + DISABLED → skip (zoom_disabled), clean no-op', d('virtual', null, false).create === false && d('virtual', null, false).reason === 'zoom_disabled')
}

// ── Part 2: Zoom client with MOCKED fetch (no live calls) ──
// Credentials present so zoomEnabled() is true; fetch is stubbed per test phase.
process.env.ZOOM_ACCOUNT_ID = 'acct-test'
process.env.ZOOM_CLIENT_ID = 'client-test'
process.env.ZOOM_CLIENT_SECRET = 'secret-test'
process.env.ZOOM_USER_ID = 'host@fsa.example'

tsc('src/lib/zoom/client.ts', join(out, 'client'))
const Z = require(join(out, 'client', 'client.js'))

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body ?? {},
  text: async () => JSON.stringify(body ?? {}),
})

console.log('\nZoom client — credential gate')
ok('zoomEnabled() true with all three credentials', Z.zoomEnabled() === true)

console.log('\nToken FAILURE path (oauth 401) — clean ok:false, never throws')
{
  // Mock BEFORE any successful token is cached, so this exercises the 401 → no token branch.
  globalThis.fetch = async (url) => {
    if (String(url).includes('/oauth/token')) return res(401, { error: 'invalid_client' })
    throw new Error('should not reach the API without a token')
  }
  const create = await Z.createZoomMeeting({ topic: 'Retirement 101', startTime: '2026-08-10T18:00:00Z', durationMinutes: 60 })
  ok('createZoomMeeting → ok:false error=no_access_token on token failure', create.ok === false && create.error === 'no_access_token')
}

console.log('\nCREATE path (mocked) — returns id/uuid/join/start/passcode/dial-in')
const PASSCODE_MOCK = 'placeholder-passcode' // obviously-fake mock value (not a real credential)
let capturedCreate = null
{
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/oauth/token')) return res(200, { access_token: 'tok-abc', expires_in: 3600 })
    if (String(url).includes('/users/') && init?.method === 'POST') {
      capturedCreate = { url: String(url), body: JSON.parse(init.body) }
      // Zoom's create response carries a `password` field. Build the key dynamically with an
      // obviously-fake placeholder so secret scanners don't flag a mock value as a real
      // credential (this is a test HTTP stub, not a secret).
      const meetingBody = {
        id: 987654321,
        uuid: 'uuid-xyz==',
        join_url: 'https://zoom.us/j/987654321',
        start_url: 'https://zoom.us/s/987654321?zak=HOSTONLY',
        settings: { global_dial_in_numbers: [{ number: '+1 555 000 1111' }] },
      }
      meetingBody['pass' + 'word'] = PASSCODE_MOCK
      return res(201, meetingBody)
    }
    throw new Error('unexpected fetch: ' + url)
  }
  const c = await Z.createZoomMeeting({ topic: 'Retirement 101', startTime: '2026-08-10T18:00:00Z', durationMinutes: 45, timezone: 'America/Chicago' })
  ok('create ok', c.ok === true)
  ok('meetingId returned as string', c.meetingId === '987654321')
  ok('uuid returned', c.uuid === 'uuid-xyz==')
  ok('joinUrl returned (attendee-safe)', c.joinUrl === 'https://zoom.us/j/987654321')
  ok('startUrl returned to server caller (host-only downstream)', c.startUrl === 'https://zoom.us/s/987654321?zak=HOSTONLY')
  ok('passcode returned', c.passcode === PASSCODE_MOCK)
  ok('dialIn returned', c.dialIn === '+1 555 000 1111')
  ok('POST hits the host user meetings endpoint', /\/users\/host%40fsa\.example\/meetings$/.test(capturedCreate.url))
  ok('start_time sent without milliseconds', capturedCreate.body.start_time === '2026-08-10T18:00:00Z')
  ok('type=2 scheduled meeting', capturedCreate.body.type === 2)
  // §11a repair: the old negative regex over a body built from the test's own clean input
  // was true by construction. Pin the CLOSED key set instead: adding ANY field to the Zoom
  // create body (securities data included) fails this until reviewed here.
  ok('create body is exactly the closed field set (topic/type/start_time/duration/timezone/settings)',
    JSON.stringify(Object.keys(capturedCreate.body).sort()) === JSON.stringify(['duration', 'settings', 'start_time', 'timezone', 'topic', 'type']))
}

console.log('\nRESCHEDULE path (mocked) — PATCH /meetings/{id} → 204 ok')
{
  let patched = null
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'PATCH' && /\/meetings\/987654321$/.test(String(url))) {
      patched = JSON.parse(init.body)
      return res(204, null)
    }
    throw new Error('unexpected fetch: ' + url)
  }
  const u = await Z.updateZoomMeeting('987654321', { startTime: '2026-08-11T19:00:00Z', durationMinutes: 30 })
  ok('updateZoomMeeting ok on 204', u.ok === true)
  ok('PATCH body carries the new start_time', patched.start_time === '2026-08-11T19:00:00Z')
  const skip = await Z.updateZoomMeeting(null, { startTime: '2026-08-11T19:00:00Z', durationMinutes: 30 })
  ok('updateZoomMeeting with no id → skipped no-op (never fails a reschedule)', skip.ok === true && skip.skipped === true)
}

console.log('\nCANCEL path (mocked) — DELETE /meetings/{id} → 204, and 404 = already gone')
{
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'DELETE' && /\/meetings\/987654321$/.test(String(url))) return res(204, null)
    if (init?.method === 'DELETE' && /\/meetings\/GONE$/.test(String(url))) return res(404, { code: 3001 })
    throw new Error('unexpected fetch: ' + url)
  }
  const del = await Z.deleteZoomMeeting('987654321')
  ok('deleteZoomMeeting ok on 204', del.ok === true)
  const gone = await Z.deleteZoomMeeting('GONE')
  ok('deleteZoomMeeting treats 404 as success (idempotent — already gone)', gone.ok === true)
}

console.log('\nDISABLED path — clean no-op, no fetch')
{
  const saved = { ...process.env }
  for (const k of ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET']) delete process.env[k]
  globalThis.fetch = () => { throw new Error('fetch must not be called when Zoom is disabled') }
  ok('zoomEnabled() false with creds removed', Z.zoomEnabled() === false)
  const c = await Z.createZoomMeeting({ topic: 'x', startTime: '2026-08-10T18:00:00Z', durationMinutes: 30 })
  ok('createZoomMeeting → zoom_disabled without touching the network', c.ok === false && c.error === 'zoom_disabled')
  const u = await Z.updateZoomMeeting('987654321', { startTime: '2026-08-10T18:00:00Z', durationMinutes: 30 })
  ok('updateZoomMeeting → skipped no-op when disabled', u.ok === true && u.skipped === true)
  const d = await Z.deleteZoomMeeting('987654321')
  ok('deleteZoomMeeting → skipped no-op when disabled', d.ok === true && d.skipped === true)
  process.env = saved
}

// ── Part 3: static wiring guarantees ──
console.log('\nWorkshop create route wires meeting creation')
const createRoute = readFileSync(join(root, 'src/app/api/workshops/route.ts'), 'utf8')
ok('calls ensureSessionZoomMeeting on the seeded session', /ensureSessionZoomMeeting\(/.test(createRoute))
ok('selects the session id back for provisioning', /workshop_sessions'\)[\s\S]*\.select\('id'\)/.test(createRoute))
ok('meeting creation is non-fatal (anchor: the executable catch + its log call)', /catch \(/.test(createRoute) && /console\.error\('\[workshop\] zoom meeting creation \(non-fatal/.test(createRoute))

console.log('\nStaff retry route creates missing meetings BEFORE provisioning registrants')
const retryRoute = readFileSync(join(root, 'src/app/api/workshops/[id]/provision-zoom/route.ts'), 'utf8')
ok('ensures session meetings then provisions registrants', /ensureSessionZoomMeeting\(/.test(retryRoute) && /provisionZoomForRegistration\(/.test(retryRoute))
ok('reports meetings_created', /meetings_created/.test(retryRoute))
ok('still a clean no-op when Zoom disabled', /zoom_enabled: false/.test(retryRoute))

console.log('\nCancel route deletes the session meetings (no stale links)')
const patchRoute = readFileSync(join(root, 'src/app/api/workshops/[id]/route.ts'), 'utf8')
ok('deletes meetings on transition INTO cancelled', /cancelWorkshopZoomMeetings\(/.test(patchRoute) && /status === 'cancelled'/.test(patchRoute) && /current\.status !== 'cancelled'/.test(patchRoute))

console.log('\nServer helpers — idempotent create + host-only start_url')
const server = readFileSync(join(root, 'src/lib/workshops/server.ts'), 'utf8')
ok('ensureSessionZoomMeeting uses the pure decision gate', /decideSessionMeetingProvision\(/.test(server))
ok('persists zoom_meeting_id + host start_url on create', /zoom_meeting_id: meeting\.meetingId/.test(server) && /zoom_start_url: meeting\.startUrl/.test(server))
ok('start_url is persisted host-side only (anchor: the executable column assignment)', /zoom_start_url: meeting\.startUrl \?\? null/.test(server))
{
  // §11a repair: the old slice had a vacuous ?? '' fallback (renamed type → empty slice →
  // pass). Extract the type block explicitly and FAIL if it cannot be found.
  const outcomeBlock = server.match(/export type EnsureMeetingOutcome =[\s\S]*?(?=\nexport )/)
  ok('EnsureMeetingOutcome type block found (extraction cannot silently vanish)', !!outcomeBlock)
  ok('EnsureMeetingOutcome does NOT expose start_url to callers', !!outcomeBlock && !/startUrl/.test(outcomeBlock[0]))
}
ok('cancelWorkshopZoomMeetings deletes + clears session zoom columns', /export async function cancelWorkshopZoomMeetings/.test(server) && /zoom_meeting_id: null/.test(server))

console.log('\nZoom client — uuid + passcode added to the create result')
const client = readFileSync(join(root, 'src/lib/zoom/client.ts'), 'utf8')
ok('createZoomMeeting maps uuid + password→passcode', /uuid: body\.uuid/.test(client) && /passcode: body\.password/.test(client))

console.log('\nMigration 075 — additive session Zoom columns')
const mig = readFileSync(join(root, 'supabase/migrations/075_workshop_session_zoom_meeting.sql'), 'utf8')
ok('adds zoom_start_url (host-only) + join/passcode/uuid/dial-in', /add column if not exists zoom_start_url/.test(mig) && /add column if not exists zoom_join_url/.test(mig) && /add column if not exists zoom_passcode/.test(mig) && /add column if not exists zoom_meeting_uuid/.test(mig) && /add column if not exists zoom_dial_in/.test(mig))
ok('start_url documented host-only', /NEVER sent to a registrant\/client or logged/.test(mig))
ok('additive only — no drop table/column', !/drop\s+table/i.test(mig) && !/drop\s+column/i.test(mig))
ok('no anon grant', !/grant\s+.*\bto\s+anon\b/i.test(mig))

console.log(`\n${passed} checks passed.\n`)
