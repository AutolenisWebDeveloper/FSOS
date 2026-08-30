// VENUE-ZONE FAIL-CLOSED (owner-approved follow-up to the WS-005 class).
//
// Five places in workshop code rendered or scheduled from `x || 'America/Chicago'`. Central
// is only correct for a venue that happens to be Central; everywhere else the fallback
// stated — confidently, silently — a time the venue is not in. Three of the five are proven
// elsewhere by tests that already execute their surface:
//
//   • reminders.ts     dayOfNineAmMs / utcOffsetHoursForTimezone → workshop-comms.test.mjs
//   • comms-engine.ts  renderLocal / {{starts_local}}            → workshop-engine-invocation.test.mjs
//   • register route   the receipt's "When" row                  → workshop-register-route.test.mjs
//
// This file covers the remaining two, which had NO coverage at all:
//
//   • public.ts    formatInVenueZone — every date on the public funnel (hub cards, the
//                  workshop page, the register page, the cancel lookup). Executed through
//                  the bundler because public.ts imports getDb + ./server.
//   • server.ts    ensureSessionZoomMeeting's Zoom `timezone` field. Zoom's timezone is
//                  DISPLAY ONLY (start_time is an absolute UTC instant and zoom/client.ts
//                  already defaults to 'UTC'), so this was never a wrong booking — but it
//                  labelled the meeting with a zone the venue may not be in. Omitting it
//                  is strictly better than mislabelling it.
//
// DB-free: the harness's scripted PostgREST-chain fake + a recording Zoom stub.
// Run: node tests/workshop-venue-zone.test.mjs
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, fakeDb, installDb } from './helpers/workshop-harness.mjs'

let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

const stubDir = mkdtempSync(join(tmpdir(), 'fsos-venue-zone-'))
process.on('exit', () => { try { rmSync(stubDir, { recursive: true, force: true }) } catch { /* best-effort */ } })

// ── public.ts — formatInVenueZone ───────────────────────────────────────────────
const pub = await bundle('src/lib/workshops/public.ts')
// 2026-09-01 18:00Z is 1:00 PM CDT in Chicago and 11:00 AM PDT in Los Angeles — two
// resolvable zones that disagree, so a fallback to either one is visible in the output.
const ISO = '2026-09-01T18:00:00Z'

console.log('formatInVenueZone — the venue wall clock, or null (public funnel)')
{
  const chicago = pub.formatInVenueZone(ISO, 'America/Chicago')
  const la = pub.formatInVenueZone(ISO, 'America/Los_Angeles')
  ok('a resolvable zone renders that zone with its abbreviation',
    /September 1, 2026/.test(chicago) && /1:00\s?PM/.test(chicago) && /CDT/.test(chicago), chicago)
  ok('a DIFFERENT resolvable zone renders differently — the zone argument actually drives the output',
    /11:00\s?AM/.test(la) && /PDT/.test(la) && la !== chicago, la)

  // The timezone column is NOT NULL with a default, so '' — not null — is the shape an
  // unset zone arrives in. All three unusable shapes must produce nothing.
  ok('an EMPTY zone returns null — no Central date on the page someone decides to attend from',
    pub.formatInVenueZone(ISO, '') === null && pub.formatInVenueZone(ISO, '   ') === null)
  ok('an UNKNOWN zone returns null rather than falling back to a UTC string',
    pub.formatInVenueZone(ISO, 'Not/AZone') === null)
  ok('an ABSENT zone returns null',
    pub.formatInVenueZone(ISO, null) === null && pub.formatInVenueZone(ISO, undefined) === null)
  ok('a missing date still returns null (the pre-existing contract is unchanged)',
    pub.formatInVenueZone(null, 'America/Chicago') === null && pub.formatInVenueZone('', 'America/Chicago') === null)

  // Every style shares the guard — 'short' and 'time' feed the hub cards and the session
  // list, so a fallback surviving in either one would still show a guessed hour.
  ok('every style fails closed, and every style renders for a good zone',
    pub.formatInVenueZone(ISO, 'Not/AZone', 'short') === null &&
    pub.formatInVenueZone(ISO, 'Not/AZone', 'time') === null &&
    /CDT/.test(pub.formatInVenueZone(ISO, 'America/Chicago', 'short')) &&
    /CDT/.test(pub.formatInVenueZone(ISO, 'America/Chicago', 'time')))

  // Every consumer already handles null: the pages render 'Date to be announced' or drop
  // the block. This pins that the null is the EXISTING empty state, not a new crash path.
  ok('null is the callers\' established empty state — nothing here throws on it',
    ['full', 'short', 'time'].every((style) => pub.formatInVenueZone(ISO, 'Not/AZone', style) === null))
}

// ── server.ts — the Zoom meeting's display timezone ─────────────────────────────
console.log('\nensureSessionZoomMeeting — Zoom is labelled with the venue zone or not at all')
{
  globalThis.__zoomCreates = []
  const zoomStub = join(stubDir, 'zoom-stub.mjs')
  writeFileSync(zoomStub, `
export function zoomEnabled() { return true }
export async function createZoomMeeting(input) {
  globalThis.__zoomCreates.push(input)
  return { ok: true, meetingId: 'zm-1', uuid: 'uu-1', joinUrl: 'https://zoom.test/j/1', startUrl: 'https://zoom.test/s/1', passcode: 'p', dialIn: null }
}
export async function addZoomRegistrant() { return { ok: true } }
export async function deleteZoomMeeting() { return { ok: true } }
`)
  const server = await bundle('src/lib/workshops/server.ts', { aliases: { '@/lib/zoom/client': zoomStub } })

  const sessionRow = (tz) => ({
    id: 'sess-1', workshop_id: 'w-1', starts_at: ISO, ends_at: '2026-09-01T19:00:00Z',
    timezone: tz, delivery_mode: 'virtual', status: 'scheduled',
    zoom_meeting_id: null, venue_name: null, venue_address: null,
  })
  const provision = async (tz) => {
    globalThis.__zoomCreates = []
    const db = fakeDb({
      workshop_sessions: [sessionRow(tz), { id: 'sess-1' }],
      workshops: [{ workshop_id: 'w-1', title: 'Retirement Readiness 101', delivery_mode: 'virtual', status: 'published' }],
    })
    installDb(db)
    try {
      return await server.ensureSessionZoomMeeting(db, 'sess-1', 'Retirement Readiness 101')
    } finally {
      installDb(null)
    }
  }

  await provision('America/Chicago')
  const good = globalThis.__zoomCreates[0]
  ok('a resolvable venue zone is passed to Zoom as the display timezone',
    !!good && good.timezone === 'America/Chicago', JSON.stringify(good))
  ok('start_time is the absolute UTC instant either way (this was never a wrong booking)',
    !!good && good.startTime === ISO)

  await provision('')
  const blank = globalThis.__zoomCreates[0]
  ok('an EMPTY venue zone OMITS the field — zoom/client.ts then applies its own UTC default',
    !!blank && !('timezone' in blank), JSON.stringify(blank))
  ok('…and the meeting is still created with the same absolute start (fail closed on the label, not the meeting)',
    !!blank && blank.startTime === ISO && blank.durationMinutes === 60)

  await provision('Not/AZone')
  const bogus = globalThis.__zoomCreates[0]
  ok('an UNKNOWN venue zone likewise omits the field rather than labelling it Central',
    !!bogus && !('timezone' in bogus), JSON.stringify(bogus))
}

console.log(`\n${passed} checks passed.`)
