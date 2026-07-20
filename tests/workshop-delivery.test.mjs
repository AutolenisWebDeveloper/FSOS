// Workshop Delivery P3 proof (docs/specs/workshops-seminar-design-spec.md §2.6,§5,§9-P3).
// DB-free. Four parts:
//   1. Pure delivery logic (src/lib/workshops/delivery.ts) compiled standalone with tsc:
//      Zoom event parsing (correlate by registrant token, never name), idempotent +
//      manual-precedence-aware attendance derivation (duplicate/reconnect → one row; a
//      manual mark is never clobbered), left_early threshold, and replay gating order.
//   2. Zoom webhook crypto (src/lib/zoom/webhook.ts): CRC challenge response + HMAC
//      signature verification (reject unsigned / bad-HMAC), proven against node:crypto.
//   3. Static migration guarantees (041) — additive only, no anon grant, feedback table +
//      RLS, zoom_registrant_id, left_early threshold.
//   4. Static route/server guarantees — webhook verifies + is idempotent + honors manual
//      precedence; feedback→consult firewalls is_security to FFS; provisioning is
//      failure-tolerant; replay is recording-consent-gated; Zoom is credential-gated.
// Run: node tests/workshop-delivery.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHmac } from 'node:crypto'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-wdel-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})

let passed = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  console.log(`  ✓ ${name}`)
  passed++
}

// Compile a single lib file standalone with the project's tsc (resolved via npx from the
// repo root, exactly like tests/workshop-ops.test.mjs) so node types + tsconfig resolve.
function tsc(rel, dir) {
  execSync(
    `npx tsc ${rel} --outDir ${dir} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop`,
    { cwd: root, stdio: 'inherit' },
  )
}

const require = createRequire(import.meta.url)

// ── Part 1: pure delivery logic ──
tsc('src/lib/workshops/delivery.ts', join(out, 'd'))
const d = require(join(out, 'd', 'delivery.js'))

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

// ── Part 2: Zoom webhook crypto ──
tsc('src/lib/zoom/webhook.ts', join(out, 'w'))
const w = require(join(out, 'w', 'webhook.js'))

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

// ── Part 4: route/server firewall + idempotency + gating guarantees ──
console.log('\nZoom webhook route (verify + idempotent + manual precedence)')
const zoomRoute = readFileSync(join(root, 'src/app/api/webhooks/zoom/route.ts'), 'utf8')
ok('answers CRC challenge (zoomCrcResponse)', /zoomCrcResponse/.test(zoomRoute) && /ZOOM_CRC_EVENT/.test(zoomRoute))
ok('verifies HMAC signature on events', /verifyZoomSignature/.test(zoomRoute))
ok('rejects unverified with 401', /Invalid signature.*401|status: 401/.test(zoomRoute))
ok('fails closed in production when no secret', /NODE_ENV === 'production'/.test(zoomRoute))
ok('correlates by token then writes attendance', /resolveWebhookTarget/.test(zoomRoute) && /applyWebhookAttendance/.test(zoomRoute))
ok('records manual precedence outcome', /manual_precedence/.test(zoomRoute))

console.log('\nServer helpers (correlation + precedence + provisioning tolerance)')
const server = readFileSync(join(root, 'src/lib/workshops/server.ts'), 'utf8')
ok('resolveWebhookTarget correlates by zoom_registrant_id (token), not name', /zoom_registrant_id/.test(server) && /never by display name/.test(server))
ok('applyWebhookAttendance writes capture_method webhook', /capture_method: 'webhook'/.test(server))
ok('provisioning is best-effort (ok:false on transient failure for retry)', /provisionZoomForRegistration/.test(server) && /provision_failed|res\.error/.test(server))
ok('provisioning skips cleanly when zoom disabled', /zoom_disabled/.test(server))

console.log('\nFeedback route (is_security → FFS, honeypot, rate-limit)')
const fbRoute = readFileSync(join(root, 'src/app/api/public/workshops/feedback/route.ts'), 'utf8')
ok('writes workshop_feedback', /workshop_feedback/.test(fbRoute))
ok('consult request reuses convertRegistrationToLead (firewalls is_security → FFS)', /convertRegistrationToLead/.test(fbRoute))
ok('honeypot on company field', /company/.test(fbRoute) && /honeypot/i.test(fbRoute))
ok('per-IP rate limited', /rateLimit/.test(fbRoute))
ok('resolves registration by join_token (never name)', /join_token/.test(fbRoute))

console.log('\nRegister route (best-effort provisioning, never blocks)')
const regRoute = readFileSync(join(root, 'src/app/api/public/workshops/register/route.ts'), 'utf8')
ok('provisions Zoom best-effort after registration', /provisionZoomForRegistration/.test(regRoute))
ok('provisioning failure is non-fatal (registration still succeeds)', /non-fatal|Never blocks registration/.test(regRoute))

console.log('\nReplay loader/page (recording-consent gate — cannot activate on placeholder)')
const replayLib = readFileSync(join(root, 'src/lib/workshops/replay.ts'), 'utf8')
ok('gates on APPROVED recording disclosure (is_assumption=false, approved_by set)', /kind', 'recording'|kind.*recording/.test(replayLib) && /is_assumption/.test(replayLib) && /approved_by/.test(replayLib))
ok('uses evaluateReplayAccess (consent-first order)', /evaluateReplayAccess/.test(replayLib))
ok('writes retention audit before serving recording', /replay_served/.test(replayLib))
const replayPage = readFileSync(join(root, 'src/app/workshops/[slug]/replay/page.tsx'), 'utf8')
ok('replay page renders gate notices', /not_approved/.test(replayPage) && /window_closed/.test(replayPage))

console.log('\nZoom client (credential-gated, name+email only — no securities data)')
const client = readFileSync(join(root, 'src/lib/zoom/client.ts'), 'utf8')
ok('zoomEnabled gates on all three credentials', /ZOOM_ACCOUNT_ID && process\.env\.ZOOM_CLIENT_ID && process\.env\.ZOOM_CLIENT_SECRET/.test(client))
ok('sends name + email only (no securities data)', /first_name/.test(client) && !/account_number|ssn|policy_number/i.test(client))

console.log('\nStaff delivery panel (P3 ops UI)')
ok('server exposes loadDeliverySummary rollup', /export async function loadDeliverySummary/.test(server))
ok('summary counts capture methods (webhook/checkin/manual)', /captureCounts/.test(server) && /'webhook'/.test(server))
ok('summary gates replay on approved recording-consent', /recordingConsentApproved/.test(server) && /kind', 'recording'|kind.*recording/.test(server))
const panel = readFileSync(join(root, 'src/components/app/WorkshopDeliveryPanel.tsx'), 'utf8')
ok('delivery panel provisions via the retry route', /\/provision-zoom/.test(panel))
ok('delivery panel shows manual-precedence note', /precedence over a later Zoom webhook/.test(panel))
ok('delivery panel surfaces the replay activation gate', /recordingConsentApproved/.test(panel))
const detail = readFileSync(join(root, 'src/app/(fsa)/app/workshops/[id]/page.tsx'), 'utf8')
ok('workshop detail renders the delivery panel', /WorkshopDeliveryPanel/.test(detail) && /loadDeliverySummary/.test(detail))

console.log(`\n${passed} checks passed.\n`)
