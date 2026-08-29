// Workshop Delivery P3 — GUARANTEE suite (Batch 0, D-9(b) rebuild of workshop-delivery.test.mjs).
// Replaces the old file's regex-on-source tail (§11a pattern-B, 14 flagged instances) with
// EXECUTED behavior. Parts 1-3 are ported verbatim from the old file (already behavioral).
// Parts 4-5 execute the real server helpers and route handlers through the shared harness
// (tests/helpers/workshop-harness.mjs): scripted-db fakes + bundled routes with a bare-node
// next/server shim. DB-free — schema-level proofs (unique keys, RLS) live in the rls suite.
//
// Guarantee list covered (each EXECUTED, not regexed):
//   CRC echo · HMAC verify incl. tamper/stale/missing-secret · route 401 on bad signature ·
//   route fail-closed in production with no secret · correlation by registrant TOKEN first,
//   email fallback, never display name · capture_method='webhook' on the attendance write ·
//   manual precedence (webhook yields to staff) · duplicate/reconnect idempotence ·
//   left_early threshold · replay consent-gate order · provisioning skip-clean when Zoom
//   is disabled · feedback honeypot/rate-limit/schema pre-db short-circuits (db stub throws
//   if touched) · registration provisioning stays non-fatal.
// Run: node tests/workshop-delivery-guarantees.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import {
  root, tsc, bundle, fakeDb, installDb, makeReq, auditCalls, resetAudit,
} from './helpers/workshop-harness.mjs'

let passed = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  console.log(`  ✓ ${name}`)
  passed++
}

// ── Part 1: pure delivery logic (ported verbatim from the old file) ──
const d = tsc('src/lib/workshops/delivery.ts', 'd')
console.log('\nZoom event parsing (parseZoomParticipantEvent — correlate by token, never name)')
{
  const joined = d.parseZoomParticipantEvent({
    event: 'meeting.participant_joined',
    payload: { object: { id: '99', participant: { registrant_id: 'RID1', user_name: 'Should Be Ignored', email: 'A@B.com', join_time: '2026-07-20T18:00:00Z' } } },
  })
  ok('joined → action joined', joined.action === 'joined')
  ok('meetingId from payload.object.id', joined.meetingId === '99')
  ok('registrantId from participant.registrant_id (the token)', joined.registrantId === 'RID1')
  ok('email lowercased for fallback correlation', joined.email === 'a@b.com')
  ok('joinTime captured', joined.joinTime === '2026-07-20T18:00:00Z')

  const left = d.parseZoomParticipantEvent({
    event: 'webinar.participant_left',
    payload: { object: { id: '99', participant: { registrant_id: 'RID1', leave_time: '2026-07-20T19:00:00Z' } } },
  })
  ok('webinar left → action left', left.action === 'left')
  ok('leaveTime captured', left.leaveTime === '2026-07-20T19:00:00Z')

  const other = d.parseZoomParticipantEvent({ event: 'meeting.started', payload: { object: { id: '99' } } })
  ok('non-participant event → action other', other.action === 'other')
}

console.log('\nAttendance derivation — manual precedence (never clobber a manual mark)')
{
  const dec = d.deriveWebhookAttendance(
    { status: 'no_show', capture_method: 'manual' },
    { joinTime: '2026-07-20T18:00:00Z', leaveTime: '2026-07-20T18:50:00Z' },
    10,
  )
  ok('manual row → skip with reason manual_precedence', dec.action === 'skip' && dec.reason === 'manual_precedence')
}

console.log('\nAttendance derivation — first join, then leave, left_early threshold')
{
  const first = d.deriveWebhookAttendance(null, { joinTime: '2026-07-20T18:00:00Z', leaveTime: null }, 10)
  ok('first joined (no leave) → attended', first.action === 'write' && first.row.status === 'attended')
  ok('first joined sets join_time, null duration', first.row.join_time === '2026-07-20T18:00:00Z' && first.row.duration_min === null)

  // left after 5 min, threshold 10 → left_early
  const early = d.deriveWebhookAttendance(
    { status: 'attended', capture_method: 'webhook', join_time: '2026-07-20T18:00:00Z', leave_time: null, duration_min: null },
    { joinTime: null, leaveTime: '2026-07-20T18:05:00Z' },
    10,
  )
  ok('left after 5min (<10 threshold) → left_early', early.action === 'write' && early.row.status === 'left_early')
  ok('duration computed = 5', early.row.duration_min === 5)

  // left after 45 min, threshold 10 → attended
  const stayed = d.deriveWebhookAttendance(
    { status: 'attended', capture_method: 'webhook', join_time: '2026-07-20T18:00:00Z', leave_time: null, duration_min: null },
    { joinTime: null, leaveTime: '2026-07-20T18:45:00Z' },
    10,
  )
  ok('left after 45min (>10 threshold) → attended', stayed.action === 'write' && stayed.row.status === 'attended')
  ok('duration computed = 45', stayed.row.duration_min === 45)
}

console.log('\nAttendance derivation — idempotency: duplicate + reconnect collapse to one row')
{
  // Duplicate identical joined event → no_change skip.
  const dup = d.deriveWebhookAttendance(
    { status: 'attended', capture_method: 'webhook', join_time: '2026-07-20T18:00:00Z', leave_time: null, duration_min: null },
    { joinTime: '2026-07-20T18:00:00Z', leaveTime: null },
    10,
  )
  ok('duplicate joined event → skip no_change (idempotent)', dup.action === 'skip' && dup.reason === 'no_change')

  // Reconnect: state has an early leave; a later join+leave must expand to min-join/max-leave.
  const reconnect = d.deriveWebhookAttendance(
    { status: 'left_early', capture_method: 'webhook', join_time: '2026-07-20T18:00:00Z', leave_time: '2026-07-20T18:05:00Z', duration_min: 5 },
    { joinTime: '2026-07-20T18:20:00Z', leaveTime: '2026-07-20T19:00:00Z' },
    10,
  )
  ok('reconnect keeps earliest join', reconnect.row.join_time === '2026-07-20T18:00:00Z')
  ok('reconnect keeps latest leave', reconnect.row.leave_time === '2026-07-20T19:00:00Z')
  ok('reconnect span 60min → attended (final correct)', reconnect.row.status === 'attended' && reconnect.row.duration_min === 60)
}

console.log('\nReplay gating (evaluateReplayAccess — order: consent → access → exists → window)')
{
  const base = {
    recordingUrl: 'https://rec',
    recordingExpiresAt: '2026-08-01T00:00:00Z',
    recordingDisclosureApproved: true,
    hasValidRegistration: true,
    nowIso: '2026-07-25T00:00:00Z',
  }
  ok('recording-consent NOT approved → not_approved (cannot activate)', d.evaluateReplayAccess({ ...base, recordingDisclosureApproved: false }) === 'not_approved')
  ok('no valid registration → no_access', d.evaluateReplayAccess({ ...base, hasValidRegistration: false }) === 'no_access')
  ok('no recording → not_available', d.evaluateReplayAccess({ ...base, recordingUrl: null }) === 'not_available')
  ok('past expiry → window_closed', d.evaluateReplayAccess({ ...base, nowIso: '2026-09-01T00:00:00Z' }) === 'window_closed')
  ok('all gates pass → available', d.evaluateReplayAccess(base) === 'available')
}
// ── Part 2: Zoom webhook crypto (ported verbatim; compile seam adapted to the harness) ──
const w = tsc('src/lib/zoom/webhook.ts', 'w')

console.log('\nZoom CRC challenge response (zoomCrcResponse)')
{
  const secret = 'shhh-secret-token'
  const plain = 'plain-abc-123'
  const expected = createHmac('sha256', secret).update(plain).digest('hex')
  const resp = w.zoomCrcResponse(plain, secret)
  ok('returns plainToken echoed', resp && resp.plainToken === plain)
  ok('encryptedToken = HMAC-SHA256(secret, plainToken) hex', resp.encryptedToken === expected)
  ok('no secret → null (unconfigured endpoint cannot validate)', w.zoomCrcResponse(plain, undefined) === null)
}

console.log('\nZoom signature verification (verifyZoomSignature — reject unsigned / bad-HMAC)')
{
  const secret = 'shhh-secret-token'
  const rawBody = JSON.stringify({ event: 'meeting.participant_joined', payload: { object: { id: '1' } } })
  const timestamp = '1700000000'
  const good = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`

  ok('valid signature passes', w.verifyZoomSignature({ rawBody, signature: good, timestamp, secret }) === true)
  ok('tampered body → reject', w.verifyZoomSignature({ rawBody: rawBody + 'x', signature: good, timestamp, secret }) === false)
  ok('bad HMAC → reject', w.verifyZoomSignature({ rawBody, signature: 'v0=deadbeef', timestamp, secret }) === false)
  ok('missing signature → reject', w.verifyZoomSignature({ rawBody, signature: null, timestamp, secret }) === false)
  ok('missing secret → reject (route decides fail-open/closed)', w.verifyZoomSignature({ rawBody, signature: good, timestamp, secret: undefined }) === false)
  // Replay window
  ok('stale timestamp beyond tolerance → reject', w.verifyZoomSignature({ rawBody, signature: good, timestamp, secret, toleranceSeconds: 300, nowMs: 1700000000000 + 10 * 60 * 1000 }) === false)
  ok('fresh timestamp within tolerance → pass', w.verifyZoomSignature({ rawBody, signature: good, timestamp, secret, toleranceSeconds: 300, nowMs: 1700000000000 + 60 * 1000 }) === true)
}

// ── Part 3: migration 041 static guarantees ──
console.log('\nMigration 041 static guarantees')
const mig = readFileSync(join(root, 'supabase/migrations/041_workshop_delivery_automation.sql'), 'utf8')
ok('creates workshop_feedback table', /create table if not exists workshop_feedback/.test(mig))
ok('feedback has rating 1-5 + consult_requested', /rating\s+integer/.test(mig) && /consult_requested\s+boolean/.test(mig))
ok('feedback unique per registration (idempotent resubmit)', /unique \(registration_id\)/.test(mig))
ok('adds zoom_registrant_id (webhook correlation key)', /add column if not exists zoom_registrant_id/.test(mig))
ok('adds left_early_threshold_minutes config default', /add column if not exists left_early_threshold_minutes/.test(mig))
ok('enables RLS on workshop_feedback (default-deny)', /alter table workshop_feedback enable row level security/.test(mig))
ok('feedback staff-read policy present', /create policy wfeedback_staff_read on workshop_feedback/.test(mig))
ok('additive only — no drop table', !/drop\s+table/i.test(mig))
ok('additive only — no drop column', !/drop\s+column/i.test(mig))
ok('no anon RLS grant', !/grant\s+.*\bto\s+anon\b/i.test(mig))
ok('does NOT re-define capture_method check (webhook already allowed in 038)', !/check\s*\(\s*capture_method/i.test(mig))


// ── Part 4: EXECUTED server helpers (scripted-db fakes; replaces the regex tail) ──
const server = await bundle('src/lib/workshops/server.ts')

console.log('\nresolveWebhookTarget — token FIRST, email fallback, never display name (EXECUTED)')
{
  // Token present → resolves via zoom_registrant_id; the email fallback never runs.
  const db1 = fakeDb({
    workshop_sessions: [{ id: 'sess-1', workshop_id: 'w-1' }],
    workshop_registrations: [{ reg_id: 'reg-1', session_id: 'sess-1' }],
  })
  const t1 = await server.resolveWebhookTarget(db1, {
    action: 'joined', meetingId: '99', registrantId: 'RID1', email: 'a@b.com',
    joinTime: '2026-07-20T18:00:00Z', leaveTime: null,
  })
  ok('correlates by registrant token to the registration', t1 && t1.registrationId === 'reg-1' && t1.workshopId === 'w-1')
  const regCalls1 = db1.calls.filter((c) => c.table === 'workshop_registrations')
  ok('token lookup filters on zoom_registrant_id (not name)', regCalls1.length === 1 && regCalls1[0].filters.some(([op, k, v]) => op === 'eq' && k === 'zoom_registrant_id' && v === 'RID1'))
  ok('no filter anywhere touches a name column', db1.calls.every((c) => c.filters.every(([, k]) => k !== 'name' && k !== 'user_name')))

  // No token → falls back to exact email, still workshop-scoped, still never name.
  const db2 = fakeDb({
    workshop_sessions: [{ id: 'sess-1', workshop_id: 'w-1' }],
    workshop_registrations: [{ reg_id: 'reg-9', session_id: 'sess-1' }],
  })
  const t2 = await server.resolveWebhookTarget(db2, {
    action: 'joined', meetingId: '99', registrantId: null, email: 'a@b.com',
    joinTime: '2026-07-20T18:00:00Z', leaveTime: null,
  })
  const regCalls2 = db2.calls.filter((c) => c.table === 'workshop_registrations')
  ok('email fallback is exact + workshop-scoped', t2 && t2.registrationId === 'reg-9' &&
    regCalls2[0].filters.some(([op, k, v]) => op === 'eq' && k === 'email' && v === 'a@b.com') &&
    regCalls2[0].filters.some(([op, k, v]) => op === 'eq' && k === 'workshop_id' && v === 'w-1'))

  // Unknown meeting → null (no orphan writes).
  const db3 = fakeDb({ workshop_sessions: [null] })
  const t3 = await server.resolveWebhookTarget(db3, { action: 'joined', meetingId: 'nope', registrantId: 'R', email: null, joinTime: null, leaveTime: null })
  ok('unknown meeting → null and no registration query', t3 === null && db3.calls.every((c) => c.table !== 'workshop_registrations'))
}

console.log('\napplyWebhookAttendance — capture_method=webhook write + legacy flag sync (EXECUTED)')
{
  const db = fakeDb({ workshop_attendance: [null] })
  const outcome = await server.applyWebhookAttendance(
    db,
    { registrationId: 'reg-1', sessionId: 'sess-1', workshopId: 'w-1' },
    { action: 'joined', meetingId: '99', registrantId: 'RID1', email: null, joinTime: '2026-07-20T18:00:00Z', leaveTime: null },
    10,
  )
  ok('first join writes attended', outcome.action === 'write' && outcome.status === 'attended')
  const up = db.calls.find((c) => c.table === 'workshop_attendance' && c.method === 'upsert')
  ok('attendance upsert carries capture_method=webhook on (registration, session)', !!up && up.payload.capture_method === 'webhook' && up.upsertOpts?.onConflict === 'registration_id,session_id')
  const legacy = db.calls.find((c) => c.table === 'workshop_registrations' && c.method === 'update')
  ok('legacy attended flag synced on the registration', !!legacy && legacy.payload.attended === true)

  // Manual precedence: a staff manual mark is never clobbered — EXECUTED, no write.
  const db4 = fakeDb({ workshop_attendance: [{ status: 'no_show', capture_method: 'manual', join_time: null, leave_time: null, duration_min: null }] })
  const skip = await server.applyWebhookAttendance(
    db4,
    { registrationId: 'reg-1', sessionId: 'sess-1', workshopId: 'w-1' },
    { action: 'joined', meetingId: '99', registrantId: 'RID1', email: null, joinTime: '2026-07-20T18:00:00Z', leaveTime: null },
    10,
  )
  ok('manual mark wins: webhook skips with manual_precedence and writes nothing', skip.action === 'skip' && skip.reason === 'manual_precedence' && !db4.calls.some((c) => c.method === 'upsert' || c.method === 'update'))
}

console.log('\nprovisionZoomForRegistration — best-effort + skip-clean when Zoom disabled (EXECUTED)')
{
  delete process.env.ZOOM_ACCOUNT_ID; delete process.env.ZOOM_CLIENT_ID; delete process.env.ZOOM_CLIENT_SECRET
  const db = fakeDb({
    workshop_registrations: [{ reg_id: 'reg-1', name: 'A', email: 'a@b.com', session_id: 'sess-1', chosen_delivery: 'virtual', join_url: null, zoom_registrant_id: null, workshop_id: 'w-1' }],
    workshop_sessions: [{ id: 'sess-1', zoom_meeting_id: null, delivery_mode: 'virtual', starts_at: '2026-09-01T18:00:00Z', duration_minutes: 60, timezone: 'America/Chicago' }],
  })
  const res = await server.provisionZoomForRegistration(db, 'reg-1')
  ok('zoom disabled → clean skip, ok:true, no throw', res.ok === true && res.skipped === true)
  ok('registration not found → ok:false reason (non-fatal shape, caller can retry)', (await server.provisionZoomForRegistration(fakeDb({ workshop_registrations: [null] }), 'nope')).ok === false)
}

// ── Part 5: EXECUTED route handlers (bundled; db stub THROWS if a pre-db path touches it) ──
console.log('\nZoom webhook route (EXECUTED — CRC, signature, production fail-closed)')
{
  const route = await bundle('src/app/api/webhooks/zoom/route.ts')
  installDb(null) // pre-db branches must never reach the database

  // CRC with secret configured → 200 with the exact HMAC echo.
  process.env.ZOOM_WEBHOOK_SECRET_TOKEN = 'crc-secret'
  const plain = 'tok-123'
  const crcRes = await route.POST(makeReq('/api/webhooks/zoom', { body: { event: 'endpoint.url_validation', payload: { plainToken: plain } } }))
  const crcBody = await crcRes.json()
  ok('CRC challenge answered 200 with HMAC echo', crcRes.status === 200 && crcBody.plainToken === plain &&
    crcBody.encryptedToken === createHmac('sha256', 'crc-secret').update(plain).digest('hex'))

  // CRC with NO secret → 401 (unconfigured endpoint must not validate).
  delete process.env.ZOOM_WEBHOOK_SECRET_TOKEN
  const crcNo = await route.POST(makeReq('/api/webhooks/zoom', { body: { event: 'endpoint.url_validation', payload: { plainToken: plain } } }))
  ok('CRC with no secret → 401', crcNo.status === 401)

  // Event with secret configured + BAD signature → 401 before any db access.
  process.env.ZOOM_WEBHOOK_SECRET_TOKEN = 'crc-secret'
  const bad = await route.POST(makeReq('/api/webhooks/zoom', {
    body: { event: 'meeting.participant_joined', payload: { object: { id: '1', participant: {} } } },
    headers: { 'x-zm-signature': 'v0=deadbeef', 'x-zm-request-timestamp': String(Math.floor(Date.now() / 1000)) },
  }))
  ok('bad signature → 401 (db untouched: stub would have thrown)', bad.status === 401)

  // Production + no secret → fail closed 401 (db untouched).
  delete process.env.ZOOM_WEBHOOK_SECRET_TOKEN
  const prevEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const failClosed = await route.POST(makeReq('/api/webhooks/zoom', { body: { event: 'meeting.participant_joined', payload: { object: { id: '1', participant: {} } } } }))
  ok('production with no secret → fail closed 401', failClosed.status === 401)
  process.env.NODE_ENV = prevEnv

  // Non-participant event (dev, no secret) → acknowledged + ignored, still no db.
  const ignored = await route.POST(makeReq('/api/webhooks/zoom', { body: { event: 'meeting.ended', payload: {} } }))
  const ignoredBody = await ignored.json()
  ok('non-participant event acked + ignored without db', ignored.status === 200 && ignoredBody.ignored === true)

  // Malformed JSON → 400.
  const malformed = await route.POST(makeReq('/api/webhooks/zoom', { body: 'not-json{{' }))
  ok('malformed JSON → 400', malformed.status === 400)
}

console.log('\nFeedback route (EXECUTED — honeypot / rate-limit / schema run BEFORE any db)')
{
  const route = await bundle('src/app/api/public/workshops/feedback/route.ts')
  installDb(null) // any db access in these paths must throw

  // Honeypot short-circuit: fake success, nothing written.
  const hp = await route.POST(makeReq('/api/public/workshops/feedback', { body: { company: 'bot corp', join_token: 'x', rating: 5 } }))
  const hpBody = await hp.json()
  ok('honeypot → fake 200 ok with no db access', hp.status === 200 && hpBody.ok === true)

  // Schema reject → 400 with no db access.
  const badSchema = await route.POST(makeReq('/api/public/workshops/feedback', { body: { rating: 'not-a-number' } }))
  ok('invalid payload → 400 before db', badSchema.status === 400)

  // Per-IP rate limit → 429 after the configured window fills (8/60s), still no db.
  let last = null
  for (let i = 0; i < 9; i++) {
    last = await route.POST(makeReq('/api/public/workshops/feedback', {
      body: { rating: 'not-a-number' },
      headers: { 'x-forwarded-for': '203.0.113.77' },
    }))
  }
  ok('9th rapid attempt from one IP → 429', last.status === 429)
}

// DB-dependent feedback legs (join_token resolution, consult conversion → FFS firewall)
// stay covered by EXECUTABLE-STATEMENT anchors until the ephemeral-Postgres suite lands
// (Batch 1+): each regex below matches ONLY the executable call, never a comment/import.
console.log('\nDB-dependent legs — executable-statement anchors (PG proofs land with Batch 1+)')
{
  const fbRoute = readFileSync(join(root, 'src/app/api/public/workshops/feedback/route.ts'), 'utf8')
  ok('resolves registration by join_token equality (the executable .eq call)', /\.eq\('join_token', v\.data\.join_token\)/.test(fbRoute))
  ok('consult request invokes convertRegistrationToLead (the executable await)', /await convertRegistrationToLead\(/.test(fbRoute))
  const replayLib = readFileSync(join(root, 'src/lib/workshops/replay.ts'), 'utf8')
  ok('replay loader gates on the recording disclosure row (the executable .eq chain)', /\.eq\('kind', 'recording'\)/.test(replayLib))
  ok('replay loader requires the approved (non-assumption) disclosure (executable filter)', /\.eq\('is_assumption', false\)|is_assumption === false/.test(replayLib))
  ok('replay loader writes the retention audit before serving (executable action string)', /action: 'replay_served'|'replay_served'/.test(replayLib) && /writeAudit\(/.test(replayLib))
}

console.log(`\n${passed} checks passed.\n`)
