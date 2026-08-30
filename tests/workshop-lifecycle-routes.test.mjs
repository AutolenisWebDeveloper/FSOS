// Batch 4 — the lifecycle ROUTES executed (bundled handlers, scripted db):
//   • WS-076: a publish PATCH that fails the gate applies ZERO side effects (no
//     presenter sync, no material snapshot, no workshop write) — validation first.
//   • WS-070b at the route: terminal → anything-but-draft is a clean 422; the reopen
//     to draft succeeds and says what republish will take.
//   • WS-007: a session reschedule/venue change writes the SESSION, bumps the cadence
//     generation on a MATERIAL change only, records the right change kind (time
//     dominates), and mirrors workshops.scheduled_at.
//   • WS-074/WS-075 on /approve: status precondition; an approval-time body edit mints
//     a NEW disclosure version (the shared row is never rewritten) and the snapshot +
//     gate-open reference the new version.
//   • WS-009: the public cancel route — invalid token 404, idempotent re-cancel, past
//     event 409, and the success path writing status+cancelled_at and CLAIMING the
//     cancel_ack at generation 0 through the engine's send path.
//   • WS-040: a registrations PATCH attendance mark writes the workshop_attendance
//     TABLE (manual capture) — not just the legacy flag.
// DB semantics behind these (triggers, cascade, 4-part key) are proven against real
// Postgres in tests/workshop-lifecycle.test.mjs.
// Run: node tests/workshop-lifecycle-routes.test.mjs
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, fakeDb, installDb, makeReq, auditCalls, resetAudit } from './helpers/workshop-harness.mjs'

let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

const stubDir = mkdtempSync(join(tmpdir(), 'fsos-auth-stub-'))
process.on('exit', () => { try { rmSync(stubDir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const authStub = join(stubDir, 'auth-stub.mjs')
writeFileSync(authStub, `
const session = { userId: 'u-test', roles: ['fsa'], email: 'fsa@test.example' }
export async function requireApiRole() { return { ok: true, session } }
export function requirePermission() { return null }
export function actorOf() { return 'fsa:u-test' }
export function hasSecuritiesScope() { return false }
`)

const W = 'aaaa1111-1111-1111-1111-111111111111'
const S1 = 'aaaa2222-2222-2222-2222-222222222222'
const props = { params: Promise.resolve({ id: W }) }
const patchRoute = await bundle('src/app/api/workshops/[id]/route.ts', { aliases: { '@/lib/auth/api': authStub } })
const approveRoute = await bundle('src/app/api/workshops/[id]/approve/route.ts', { aliases: { '@/lib/auth/api': authStub } })
const cancelRoute = await bundle('src/app/api/public/workshops/cancel/route.ts')
const regRoute = await bundle('src/app/api/workshops/registrations/[id]/route.ts', { aliases: { '@/lib/auth/api': authStub } })

const req = (body) => makeReq('/api/x', { method: 'PATCH', body })
const post = (body, ip) => makeReq('/api/x', { method: 'POST', body, headers: { 'x-forwarded-for': ip ?? '203.0.113.5' } })

console.log('WS-076 — a gate-rejected publish applies ZERO side effects')
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'draft', compliance_approval_ref: null, disclosure_config_id: null }],
  }))
  const res = await patchRoute.PATCH(req({ status: 'published', presenter_ids: ['aaaa9999-9999-9999-9999-999999999999'], hero_image_ref: 'assets/hero.png' }), props)
  installDb(null)
  ok('publish without an approval → 422', res.status === 422)
  ok('presenter sync did NOT run (no workshop_presenters write)',
    !db.calls.some((c) => c.table === 'workshop_presenters'))
  ok('material snapshot did NOT run (no workshop_materials write)',
    !db.calls.some((c) => c.table === 'workshop_materials'))
  ok('no workshops write happened',
    !db.calls.some((c) => c.table === 'workshops' && c.method !== 'select'))
}

console.log('WS-070b at the route — terminal workshops')
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'cancelled', compliance_approval_ref: 'old-appr', disclosure_config_id: null }],
  }))
  const res = await patchRoute.PATCH(req({ status: 'published' }), props)
  installDb(null)
  const body = await res.json()
  ok('cancelled → published is a clean 422 naming the reopen path',
    res.status === 422 && /reopen/i.test(String(body.error)), JSON.stringify(body))
  ok('…with no writes', !db.calls.some((c) => c.method !== 'select'))

  installDb(fakeDb({
    workshops: [
      { workshop_id: W, status: 'cancelled', compliance_approval_ref: 'old-appr', disclosure_config_id: null },
      [{ workshop_id: W, status: 'draft' }],
    ],
  }))
  const res2 = await patchRoute.PATCH(req({ status: 'draft' }), props)
  installDb(null)
  const body2 = await res2.json()
  ok('cancelled → draft (the reopen) succeeds and says republish needs fresh approval + Zoom',
    res2.status === 200 && body2.reopened === true && Array.isArray(body2.requires) && body2.requires.length === 2,
    JSON.stringify(body2))
}

console.log('WS-007 — session reschedule / venue change through the PATCH')
const TARGET = {
  id: S1, workshop_id: W, starts_at: '2026-09-01T18:00:00Z', ends_at: null,
  timezone: 'America/Chicago', venue_name: 'Old Hall', venue_address: null,
  status: 'scheduled', cadence_generation: 1,
}
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'published', compliance_approval_ref: 'a', disclosure_config_id: 'd' }, [{ workshop_id: W, status: 'published' }]],
    workshop_sessions: [{ ...TARGET }, null],
  }))
  const res = await patchRoute.PATCH(req({ starts_at: '2026-09-02T18:00:00Z', venue_name: 'New Hall' }), props)
  installDb(null)
  const body = await res.json()
  ok('the reschedule PATCH succeeds and reports the session change', res.status === 200 && body.session_change?.kind === 'change_reschedule' && body.session_change?.generation === 2, JSON.stringify(body))
  const sUpd = db.calls.find((c) => c.table === 'workshop_sessions' && c.method === 'update')
  ok('the SESSION is written with the new time + venue',
    !!sUpd && sUpd.payload.starts_at === '2026-09-02T18:00:00Z' && sUpd.payload.venue_name === 'New Hall')
  ok('a MATERIAL time change bumps the generation and records change_reschedule (time dominates venue)',
    sUpd.payload.cadence_generation === 2 && sUpd.payload.change_kind === 'change_reschedule' && !!sUpd.payload.change_recorded_at)
  const wUpd = db.calls.find((c) => c.table === 'workshops' && c.method === 'update')
  ok('the legacy workshops.scheduled_at mirror follows the session start',
    !!wUpd && wUpd.payload.scheduled_at === '2026-09-02T18:00:00Z')
}
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'published', compliance_approval_ref: 'a', disclosure_config_id: 'd' }, [{ workshop_id: W, status: 'published' }]],
    workshop_sessions: [{ ...TARGET }, null],
  }))
  const res = await patchRoute.PATCH(req({ venue_name: 'Annex B' }), props)
  installDb(null)
  const sUpd = db.calls.find((c) => c.table === 'workshop_sessions' && c.method === 'update')
  ok('a venue-only change records change_venue at generation 2',
    res.status === 200 && sUpd.payload.change_kind === 'change_venue' && sUpd.payload.cadence_generation === 2)
  const wUpd = db.calls.find((c) => c.table === 'workshops' && c.method === 'update')
  ok('…and does NOT touch the scheduled_at mirror (time unchanged)',
    !!wUpd && !('scheduled_at' in wUpd.payload))
}
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'published', compliance_approval_ref: 'a', disclosure_config_id: 'd' }, [{ workshop_id: W, status: 'published' }]],
    workshop_sessions: [{ ...TARGET }, null],
  }))
  const res = await patchRoute.PATCH(req({ venue_name: 'Old Hall' }), props)
  installDb(null)
  const sUpd = db.calls.find((c) => c.table === 'workshop_sessions' && c.method === 'update')
  ok('an IMMATERIAL edit (same values) bumps nothing and queues no notice',
    res.status === 200 && !!sUpd && !('cadence_generation' in sUpd.payload) && !('change_kind' in sUpd.payload))
}
{
  installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'published', compliance_approval_ref: 'a', disclosure_config_id: 'd' }],
    workshop_sessions: [{ ...TARGET, status: 'cancelled' }],
  }))
  const res = await patchRoute.PATCH(req({ session_id: S1, starts_at: '2026-09-02T18:00:00Z' }), props)
  installDb(null)
  ok('a cancelled session cannot be rescheduled (422)', res.status === 422)
}
{
  // COVERAGE GAP (re-audit item 1): the explicit `session_id` + schedule-change path was
  // only ever exercised on its 422. A route can reject correctly and still write to the
  // wrong session on success — WS-042 was exactly that shape — so the SUCCESS path is
  // proven here, on a healthy session, with the target asserted.
  const S2 = 'aaaa3333-3333-3333-3333-333333333333'
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'published', compliance_approval_ref: 'a', disclosure_config_id: 'd' }, [{ workshop_id: W, status: 'published' }]],
    workshop_sessions: [{ ...TARGET, id: S2 }, null],
  }))
  const res = await patchRoute.PATCH(req({ session_id: S2, starts_at: '2026-09-05T18:00:00Z', venue_name: 'Named Hall' }), props)
  installDb(null)
  const body = await res.json()
  ok('a reschedule that NAMES its session succeeds (the explicit-target success path, not just its 422)',
    res.status === 200, `status=${res.status} body=${JSON.stringify(body)}`)
  ok('…and reports a material change: time dominates venue',
    body.session_change?.kind === 'change_reschedule' && body.session_change?.generation === 2, JSON.stringify(body))
  const sUpd = db.calls.find((c) => c.table === 'workshop_sessions' && c.method === 'update')
  ok('…writing the new time AND venue', !!sUpd && sUpd.payload.starts_at === '2026-09-05T18:00:00Z' && sUpd.payload.venue_name === 'Named Hall')
  ok('…re-arming the cadence on THAT session and recording the change kind',
    !!sUpd && sUpd.payload.cadence_generation === 2 && sUpd.payload.change_kind === 'change_reschedule')
  // The two branches are told apart by the SELECT that resolved the target: the explicit
  // path filters on the session id alone; the fallback filters workshop_id + status +
  // an upcoming-starts_at window. Asserting the UPDATE's id is not enough — a scripted
  // fake returns the same row either way, so that assertion survives the branch being
  // deleted. This one does not.
  const sSel = db.calls.find((c) => c.table === 'workshop_sessions' && c.method === 'select')
  const f = (op, k) => !!sSel && sSel.filters.some((x) => x[0] === op && x[1] === k)
  ok('…resolved by the NAMED session id (eq id), not by the workshop\'s upcoming-session query',
    !!sSel && sSel.filters.some(([op, k, v]) => op === 'eq' && k === 'id' && v === S2) &&
      !f('eq', 'workshop_id') && !f('gte', 'starts_at') && !f('neq', 'status'),
    JSON.stringify(sSel?.filters))
  ok('…and the write lands on that same resolved session',
    !!sUpd && sUpd.filters.some(([op, k, v]) => op === 'eq' && k === 'id' && v === S2))
  const wUpd = db.calls.find((c) => c.table === 'workshops' && c.method === 'update')
  ok('…and workshops.scheduled_at is mirrored to the new time',
    !!wUpd && wUpd.payload.scheduled_at === '2026-09-05T18:00:00Z', JSON.stringify(wUpd?.payload))
}
{
  // The explicit path's own safety check: a session id that belongs to a DIFFERENT
  // workshop must be refused, not silently rescheduled.
  const OTHER = 'aaaa4444-4444-4444-4444-444444444444'
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'published', compliance_approval_ref: 'a', disclosure_config_id: 'd' }],
    workshop_sessions: [{ ...TARGET, id: OTHER, workshop_id: 'bbbb0000-0000-0000-0000-000000000000' }],
  }))
  const res = await patchRoute.PATCH(req({ session_id: OTHER, starts_at: '2026-09-06T18:00:00Z' }), props)
  installDb(null)
  ok('a session_id belonging to another workshop is refused (422), with no session write',
    res.status === 422 && !db.calls.some((c) => c.table === 'workshop_sessions' && c.method === 'update'))
  ok('…and no workshop mirror write either', !db.calls.some((c) => c.table === 'workshops' && c.method === 'update'))
}

console.log('WS-074 — /approve status precondition')
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'published', disclosure_config_id: 'd1' }],
  }))
  const res = await approveRoute.POST(post({ decision: 'approved', approver_name: 'FFS Principal' }), props)
  installDb(null)
  ok('approving a PUBLISHED workshop → 422 (draft/pending_review only)', res.status === 422)
  ok('…and no approval row was minted', !db.calls.some((c) => c.table === 'workshop_approvals'))
}

console.log('WS-075 — approval-time body edit mints a NEW disclosure version')
const D1 = 'dddd1111-1111-1111-1111-111111111111'
const D2 = 'dddd2222-2222-2222-2222-222222222222'
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'pending_review', disclosure_config_id: null }, null],
    workshop_disclosure_configs: [
      { id: D1, kind: 'sms', version: 3, body: 'OLD APPROVED TEXT' },
      { version: 7 }, // current max version for the kind
      { id: D2, version: 8 }, // the insert's returned row
    ],
    workshop_materials: [[]],
    workshop_presenters: [[]],
    workshop_approvals: [{ id: 'appr-1' }],
  }))
  const res = await approveRoute.POST(
    post({ decision: 'approved', approver_name: 'FFS Principal', disclosure_config_id: D1, disclosure_body: 'REVISED FINAL TEXT' }), props)
  installDb(null)
  ok('the edited-body approval succeeds', res.status === 200)
  const ins = db.calls.find((c) => c.table === 'workshop_disclosure_configs' && c.method === 'insert')
  ok('a NEW version row is inserted (kind kept, version = max+1, approved on arrival)',
    !!ins && ins.payload.kind === 'sms' && ins.payload.version === 8 && ins.payload.body === 'REVISED FINAL TEXT' && ins.payload.is_assumption === false)
  ok('the SHARED row is never rewritten (no disclosure update carries a body)',
    !db.calls.some((c) => c.table === 'workshop_disclosure_configs' && c.method === 'update' && 'body' in (c.payload ?? {})))
  const appr = db.calls.find((c) => c.table === 'workshop_approvals' && c.method === 'insert')
  ok('the approval snapshot references the NEW version',
    !!appr && appr.payload.material_versions?.disclosure?.id === D2 && appr.payload.material_versions?.disclosure?.version === 8)
  const wUpd = db.calls.find((c) => c.table === 'workshops' && c.method === 'update')
  ok('the workshop gate-opens under the NEW version',
    !!wUpd && wUpd.payload.disclosure_config_id === D2 && wUpd.payload.status === 'compliance_approved')
}
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'draft', disclosure_config_id: null }, null],
    workshop_disclosure_configs: [{ id: D1, kind: 'sms', version: 3, body: 'FINAL TEXT' }, null],
    workshop_materials: [[]],
    workshop_presenters: [[]],
    workshop_approvals: [{ id: 'appr-2' }],
  }))
  const res = await approveRoute.POST(
    post({ decision: 'approved', approver_name: 'FFS Principal', disclosure_config_id: D1 }), props)
  installDb(null)
  ok('an unchanged-body approval blesses IN PLACE (no new version row)',
    res.status === 200 && !db.calls.some((c) => c.table === 'workshop_disclosure_configs' && c.method === 'insert'))
  const bless = db.calls.find((c) => c.table === 'workshop_disclosure_configs' && c.method === 'update')
  ok('…as a metadata-only update (approved_by set, body untouched)',
    !!bless && bless.payload.is_assumption === false && !!bless.payload.approved_by && !('body' in bless.payload))
}

console.log('WS-009 — public cancel route')
const R1 = 'eeee1111-1111-1111-1111-111111111111'
{
  installDb(fakeDb({ workshop_registrations: [null] }))
  const res = await cancelRoute.POST(post({ token: 'tok-not-real-12345' }, '198.51.100.20'))
  installDb(null)
  ok('an unknown token → 404 with no detail leak', res.status === 404)
}
{
  const db = installDb(fakeDb({
    workshop_registrations: [{ reg_id: R1, workshop_id: W, session_id: S1, status: 'cancelled', cancelled_at: '2026-08-01T00:00:00Z' }],
  }))
  const res = await cancelRoute.POST(post({ token: 'tok-cancelled-12345' }, '198.51.100.21'))
  installDb(null)
  const body = await res.json()
  ok('re-cancelling is idempotent (200, already_cancelled, no write)',
    res.status === 200 && body.already_cancelled === true &&
      !db.calls.some((c) => c.table === 'workshop_registrations' && c.method === 'update'))
}
{
  installDb(fakeDb({
    workshop_registrations: [{ reg_id: R1, workshop_id: W, session_id: S1, status: 'registered', cancelled_at: null }],
    workshop_sessions: [{ starts_at: '2020-01-01T00:00:00Z' }],
  }))
  const res = await cancelRoute.POST(post({ token: 'tok-past-1234567' }, '198.51.100.22'))
  installDb(null)
  ok('a past event → 409 (nothing left to cancel)', res.status === 409)
}
{
  resetAudit()
  const future = new Date(Date.now() + 7 * 864e5).toISOString()
  const regFull = {
    reg_id: R1, name: 'Alex', email: 'alex@example.com', phone: null, consent_channels: ['email'],
    join_url: null, join_token: 'tok-live-1234567', registered_at: '2026-08-01T00:00:00Z',
    marketing_opt_in: false, status: 'cancelled', workshop_id: W, session_id: S1,
    lead_converted_at: null, referral_id: null,
  }
  const db = installDb(fakeDb({
    workshop_registrations: [
      { reg_id: R1, workshop_id: W, session_id: S1, status: 'registered', cancelled_at: null },
      null, // the cancel update
      regFull, // the engine's REG_COLS re-select for the ack
    ],
    workshop_sessions: [
      { starts_at: future }, // the past-check
      { id: S1, workshop_id: W, starts_at: future, ends_at: null, timezone: 'America/Chicago', venue_name: null, venue_address: null, status: 'scheduled', cadence_generation: 1 },
    ],
    workshops: [{ workshop_id: W, title: 'T', slug: 't', is_security: false, status: 'published' }],
    workshop_comms_config: [null],
    workshop_message_log: [null, { id: 'log-1' }, null],
    workshop_message_templates: [null], // placeholder only → the ack DEFERS (D-5)
  }))
  const res = await cancelRoute.POST(post({ token: 'tok-live-1234567' }, '198.51.100.23'))
  installDb(null)
  const body = await res.json()
  ok('the live cancel succeeds', res.status === 200 && body.cancelled === true, JSON.stringify(body))
  const upd = db.calls.find((c) => c.table === 'workshop_registrations' && c.method === 'update')
  ok('the registration is cancelled with a timestamp (guarded against re-cancel)',
    !!upd && upd.payload.status === 'cancelled' && !!upd.payload.cancelled_at &&
      upd.filters.some(([op, k, v]) => op === 'neq' && k === 'status' && v === 'cancelled'))
  const claim = db.calls.find((c) => c.table === 'workshop_message_log' && c.method === 'insert')
  ok('the cancel_ack is CLAIMED through the engine path at generation 0 (email)',
    !!claim && claim.payload.kind === 'cancel_ack' && claim.payload.cadence_generation === 0 && claim.payload.channel === 'email')
  ok('with only a placeholder template the ack DEFERS — nothing dispatches (D-5)',
    auditCalls().some((a) => a.action === 'comms.deferred' && a.diff?.reason === 'template_not_approved' && a.diff?.kind === 'cancel_ack'))
  ok('the cancellation itself is audited', auditCalls().some((a) => a.action === 'entity.updated' && a.diff?.via === 'self_cancel_link'))
}

console.log('WS-040 — a PATCH attendance mark writes the attendance TABLE')
{
  const regProps = { params: Promise.resolve({ id: R1 }) }
  const db = installDb(fakeDb({
    workshop_registrations: [
      { reg_id: R1, workshop_id: W, name: 'A', email: 'a@x.com', phone: null, consent_channels: [], referral_id: null, status: 'registered', attended: false, lead_converted_at: null },
      [{ reg_id: R1, workshop_id: W, session_id: S1 }], // reconcile's registration load
      null, // reconcile's legacy-flag sync update
    ],
    workshop_attendance: [null, null], // no existing row; the upsert
  }))
  const res = await regRoute.PATCH(req({ attended: true }), regProps)
  installDb(null)
  ok('the attended PATCH succeeds', res.status === 200)
  const up = db.calls.find((c) => c.table === 'workshop_attendance' && c.method === 'upsert')
  ok('workshop_attendance is UPSERTED as a manual capture (the duality is closed)',
    !!up && up.payload.status === 'attended' && up.payload.capture_method === 'manual' &&
      up.upsertOpts?.onConflict === 'registration_id,session_id')
  const flag = db.calls.find((c) => c.table === 'workshop_registrations' && c.method === 'update')
  ok('the legacy flag stays in sync through the same path', !!flag && flag.payload.attended === true)
}
{
  const regProps = { params: Promise.resolve({ id: R1 }) }
  const db = installDb(fakeDb({
    workshop_registrations: [
      { reg_id: R1, workshop_id: W, name: 'A', email: 'a@x.com', phone: null, consent_channels: [], referral_id: null, status: 'registered', attended: true, lead_converted_at: null },
      [{ reg_id: R1, workshop_id: W, session_id: S1 }],
      null,
    ],
    workshop_attendance: [{ id: 'att-1', status: 'attended' }, null],
  }))
  const res = await regRoute.PATCH(req({ attended: false }), regProps)
  installDb(null)
  const up = db.calls.find((c) => c.table === 'workshop_attendance' && c.method === 'upsert')
  ok('marking NOT-attended records a manual no_show row',
    res.status === 200 && !!up && up.payload.status === 'no_show' && up.payload.capture_method === 'manual')
}

console.log('D-8 / WS-022 — the instant ack rides the chokepoint with the .ics attached')
{
  globalThis.__ackGateCalls = []
  const sendStub = join(stubDir, 'send-stub.mjs')
  writeFileSync(sendStub, `
export async function sendMessage(ctx) {
  globalThis.__ackGateCalls.push(ctx)
  return { sent: true, gate: { allowed: true, blockedStep: null }, messageId: 'cm-ack', reason: null }
}
`)
  const regRouteGate = await bundle('src/app/api/public/workshops/register/route.ts', { aliases: { '@/lib/comms/send': sendStub } })
  const db = fakeDb({
    workshops: [{ workshop_id: W, title: 'Retirement Readiness', status: 'published', max_attendees: 50, disclosure_config_id: null }],
    workshop_sessions: [
      { starts_at: '2026-09-01T18:00:00Z', ends_at: null, timezone: 'America/Chicago', venue_name: 'Hall', venue_address: null, ics_uid: 'uid-123@fsos' },
    ],
  })
  db.rpc = async () => ({ data: { ok: true, reg_id: 'reg-ack-1' }, error: null })
  installDb(db)
  const res = await regRouteGate.POST(makeReq('/api/public/workshops/register', {
    body: { workshop_id: W, session_id: S1, name: 'Alex', email: 'alex@example.com', marketing_opt_in: false },
    headers: { 'x-forwarded-for': '198.51.100.30' },
  }))
  installDb(null)
  ok('the registration succeeds', res.status === 200)
  const ack = globalThis.__ackGateCalls.find((c) => c.entity?.type === 'workshop_registration')
  ok('the ack goes THROUGH the chokepoint (one send path per channel — D-8)', !!ack && globalThis.__ackGateCalls.length === 1)
  ok('…as a TRANSACTIONAL email on the registration basis, under the mig-131 gate handle',
    ack.channel === 'email' && ack.purpose === 'TRANSACTIONAL' && ack.durableConsentGranted === true &&
      ack.templateId === 'eeee0000-0000-4000-8000-00000000ac01' && ack.entity.id === 'reg-ack-1')
  ok('…with a real plaintext part (WS-067 applies to the ack too)',
    typeof ack.bodyText === 'string' && ack.bodyText.includes('registered') && !/[<][a-z]/i.test(ack.bodyText))
  const att = ack.attachments?.[0]
  const ics = att ? Buffer.from(att.content, 'base64').toString('utf8') : ''
  ok('…and the .ics calendar attachment (WS-022): VCALENDAR with the session start + stable UID',
    !!att && att.filename === 'workshop.ics' && att.contentType === 'text/calendar' &&
      ics.includes('BEGIN:VCALENDAR') && ics.includes('DTSTART:20260901T180000Z') && ics.includes('UID:uid-123@fsos') &&
      ics.includes('DTEND:20260901T190000Z'), ics.slice(0, 200))
}

console.log('WS-069 — the STOP footer is appended exactly once, at the chokepoint')
{
  // RELOCATED BY THE MERGE. This branch appended the footer in dispatcher.ts; main moved
  // the append into messaging.ts (`wireBody`) so it happens once, at the one place that
  // talks to Twilio — and main's own chokepoint-paths test asserts the dispatcher must NOT
  // append it. Main's version appended UNCONDITIONALLY, which would have reinstated the
  // double-STOP this branch fixed, so WS-069's condition was ported onto main's line. The
  // two assertions are unchanged; only the seam they drive moved.
  const messagingMod = await bundle('src/lib/messaging.ts')
  const wire = []
  const deps = {
    resolvePolicy: async () => ({
      gate: { allowed: true, escalate: false },
      allowed: true,
      timezone: { resolution: { resolved: true, timeZone: 'America/Chicago', method: 'npa', input: 'caller', approximate: false }, zone: 'America/Chicago', localHour: 12, localDay: 3, secondaryZone: null, legacy: false },
      resolved: { memberId: null, householdId: null, agencyId: null, consent: true, onDNC: false, suppressed: false },
    }),
    escalate: async () => {},
    auditSent: async () => {},
    deliverEmail: async () => ({ ok: true, id: 'em-1' }),
    deliverSms: async ({ to, body }) => { wire.push({ to, body }); return { ok: true, id: 'sm-1' } },
  }
  process.env.TWILIO_ACCOUNT_SID = 'AC_test'
  process.env.TWILIO_AUTH_TOKEN = 'tok_test'
  process.env.TWILIO_PHONE_NUMBER = '+12145550000'
  process.env.SMS_A2P_APPROVED = 'true'
  await messagingMod.sendSms('+12145550100', 'See you at 6 PM.', undefined, undefined, deps)
  await messagingMod.sendSms('+12145550100', 'Rebook anytime: link Reply STOP to opt out.', undefined, undefined, deps)
  ok('a body WITHOUT opt-out language gets the footer appended (WS-033: STOP + HELP)',
    wire.length === 2 && /Reply STOP to opt out, HELP for help\.$/.test(wire[0].body) && wire[0].body.startsWith('See you at 6 PM.'),
    JSON.stringify(wire[0]))
  const stopCount = (wire[1].body.match(/reply\s+stop/gi) ?? []).length
  ok('a body ALREADY carrying "Reply STOP" (the booking templates) is NOT double-footered',
    stopCount === 1, JSON.stringify(wire[1]))
  delete process.env.SMS_A2P_APPROVED
}

console.log('WS-030 — the cron trigger authorizes on Bearer CRON_SECRET ONLY')
{
  const cronRoute = await bundle('src/app/api/cron/workshop-reminders/route.ts')
  const cronReq = (headers) => makeReq('/api/cron/workshop-reminders', { method: 'GET', headers })
  const savedSecret = process.env.CRON_SECRET

  delete process.env.CRON_SECRET
  installDb(fakeDb({}))
  const noSecret = await cronRoute.GET(cronReq({ 'x-vercel-cron': '1' }))
  ok('with NO secret configured the route refuses everything — the header alone is never trusted (fail closed)',
    noSecret.status === 401)

  process.env.CRON_SECRET = 'test-cron-secret'
  const headerOnly = await cronRoute.GET(cronReq({ 'x-vercel-cron': '1' }))
  ok('a forged x-vercel-cron header WITHOUT the Bearer secret is refused (the live-send trigger is authenticated)',
    headerOnly.status === 401)
  const wrongBearer = await cronRoute.GET(cronReq({ authorization: 'Bearer wrong' }))
  ok('a wrong Bearer is refused', wrongBearer.status === 401)
  const right = await cronRoute.GET(cronReq({ authorization: 'Bearer test-cron-secret' }))
  installDb(null)
  ok('the correct Bearer authorizes and the passes run', right.status === 200)
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
}

console.log('WS-047 residue — material edits after approval invalidate the standing approval')
{
  const db = installDb(fakeDb({
    workshops: [
      { workshop_id: W, status: 'published', compliance_approval_ref: 'appr-1', disclosure_config_id: 'd1' },
      null, // syncPresenters' own workshops update (is_security recompute)
      [{ workshop_id: W, status: 'pending_review' }],
    ],
    workshop_presenters: [null, null],
    presenters: [[]],
  }))
  const res = await patchRoute.PATCH(req({ presenter_ids: ['aaaa9999-9999-9999-9999-999999999999'] }), props)
  installDb(null)
  const body = await res.json()
  ok('a presenter edit on a PUBLISHED workshop succeeds but reports the invalidation',
    res.status === 200 && body.approval_invalidated === true, JSON.stringify(body))
  const wUpd = db.calls.filter((c) => c.table === 'workshops' && c.method === 'update').pop()
  ok('…demoting it to pending_review with the approval pointer VOIDED (fresh approval required)',
    !!wUpd && wUpd.payload.status === 'pending_review' && wUpd.payload.compliance_approval_ref === null,
    JSON.stringify(wUpd?.payload))
  ok('…and the invalidation is an auditable approval decision',
    auditCalls().some((a) => a.action === 'approval.decided' && a.diff?.decision === 'invalidated' && a.diff?.reason === 'material_edit_after_approval'))
}
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'compliance_approved', compliance_approval_ref: 'appr-1', disclosure_config_id: 'd1' }],
  }))
  const res = await patchRoute.PATCH(req({ status: 'published', presenter_ids: ['aaaa9999-9999-9999-9999-999999999999'] }), props)
  installDb(null)
  ok('publish + material change in ONE request is rejected up front (never publishable as approved content)',
    res.status === 422 && !db.calls.some((c) => c.method !== 'select'))
}

console.log('WS-042 — the recording writer (replay finally has a data source)')
{
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'completed', compliance_approval_ref: 'a', disclosure_config_id: 'd' }, [{ workshop_id: W, status: 'completed' }]],
    workshop_sessions: [{ ...TARGET, status: 'completed' }, null],
  }))
  const res = await patchRoute.PATCH(req({ recording_url: 'https://vimeo.example/w-101', recording_expires_at: '2026-10-01T00:00:00Z' }), props)
  installDb(null)
  const sUpd = db.calls.find((c) => c.table === 'workshop_sessions' && c.method === 'update')
  ok('a recording-only change lands on the COMPLETED session (recordings exist after the event)',
    res.status === 200 && !!sUpd && sUpd.payload.recording_url === 'https://vimeo.example/w-101' && !!sUpd.payload.recording_expires_at)
  ok('…and is NEVER material: no generation bump, no change notice queued',
    !('cadence_generation' in sUpd.payload) && !('change_kind' in sUpd.payload))
}
{
  // THE EXPLICIT-TARGET PATH. The block above exercises the FALLBACK (no session_id →
  // most recent non-cancelled session), which is exactly why the original coverage
  // missed the defect a review bot caught: WorkshopPatchSchema's session_id refine
  // listed only the schedule/venue fields, so a recording-only PATCH that NAMED its
  // session was rejected 400 "session_id was provided without any session change" and
  // the route's session_id branch was unreachable. Multi-session workshops take this
  // path. Both directions are pinned so the refine can never drift from the field list
  // again.
  const db = installDb(fakeDb({
    workshops: [{ workshop_id: W, status: 'completed', compliance_approval_ref: 'a', disclosure_config_id: 'd' }, [{ workshop_id: W, status: 'completed' }]],
    workshop_sessions: [{ ...TARGET, status: 'completed' }, null],
  }))
  const res = await patchRoute.PATCH(req({ session_id: S1, recording_url: 'https://vimeo.example/w-202' }), props)
  installDb(null)
  ok('a recording-only PATCH that NAMES its session is accepted (the explicit-target path is reachable)',
    res.status === 200, `status=${res.status} body=${JSON.stringify(await res.clone().json().catch(() => ({})))}`)
  const sUpd = db.calls.find((c) => c.table === 'workshop_sessions' && c.method === 'update')
  ok('…and writes the recording to THAT session', !!sUpd && sUpd.payload.recording_url === 'https://vimeo.example/w-202')
  ok('…still without a generation bump or change notice',
    !!sUpd && !('cadence_generation' in sUpd.payload) && !('change_kind' in sUpd.payload))

  installDb(fakeDb({ workshops: [{ workshop_id: W, status: 'published', compliance_approval_ref: 'a', disclosure_config_id: 'd' }] }))
  const bare = await patchRoute.PATCH(req({ session_id: S1 }), props)
  installDb(null)
  ok('a bare session_id with NO session field is STILL rejected (the guard did not go slack)',
    bare.status === 400)
}

console.log('WS-043 — a consult request alerts the FSA')
{
  globalThis.__fsaNotifies = []
  const notifyStub = join(stubDir, 'notify-stub.mjs')
  writeFileSync(notifyStub, `
export async function notifyFsa(opts) { globalThis.__fsaNotifies.push(opts); return { ok: true } }
export async function sendVisitorAck() { return { ok: true } }
export function renderHtml() { return '<p>x</p>' }
export function renderText() { return 'x' }
export function fsaNotificationInbox() { return 'fsa@test.example' }
`)
  const feedbackRoute = await bundle('src/app/api/public/workshops/feedback/route.ts', { aliases: { '@/lib/notifications/transactional': notifyStub } })
  installDb(fakeDb({
    workshop_registrations: [
      { reg_id: 'reg-fb-1', name: 'Fiona', email: 'f@x.com', phone: null, session_id: S1, workshop_id: W, lead_converted_at: null },
      null, // convertRegistrationToLead's update
    ],
    workshop_feedback: [null],
    workshops: [{ is_security: false, slug: 'w', title: 'Retirement Readiness' }],
  }))
  const res = await feedbackRoute.POST(post({ join_token: 'tok-feedback-123', consult_requested: true, rating: 5 }, '198.51.100.40'))
  installDb(null)
  ok('the feedback submit succeeds', res.status === 200)
  const alert = globalThis.__fsaNotifies[0]
  ok('notifyFsa fired with the requester + workshop (live buying signal reaches the FSA)',
    globalThis.__fsaNotifies.length === 1 && /consult/i.test(alert.subject) &&
      alert.rows?.some((r) => r.value === 'f@x.com'), JSON.stringify(alert ?? null))
}

console.log('WS-033 — HELP keyword: carrier-required TwiML auto-response')
{
  const twilioMod = await bundle('src/lib/comms/twilio.ts')
  ok('messageTwiml escapes XML and wraps a <Message>',
    twilioMod.messageTwiml('a & b <c>') === '<?xml version="1.0" encoding="UTF-8"?><Response><Message>a &amp; b &lt;c&gt;</Message></Response>')

  const inboundStub = join(stubDir, 'inbound-stub.mjs')
  writeFileSync(inboundStub, `
export async function processInbound(input) {
  globalThis.__inboundCalls = globalThis.__inboundCalls ?? []
  globalThis.__inboundCalls.push(input)
  const first = (input.body || '').trim().toLowerCase().split(/\s+/)[0]
  return first === 'help' ? { helpResponse: 'Test Brand: for help call 555. Reply STOP to opt out.' } : {}
}
`)
  const savedToken = process.env.TWILIO_AUTH_TOKEN
  delete process.env.TWILIO_AUTH_TOKEN // non-production fail-open verify (documented)
  const webhook = await bundle('src/app/api/webhooks/twilio/inbound/route.ts', { aliases: { '@/lib/comms/inbound': inboundStub } })
  const form = (body) => makeReq('/api/webhooks/twilio/inbound', {
    method: 'POST',
    body: new URLSearchParams({ From: '+12145550188', Body: body, MessageSid: 'SM1' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
  const helpRes = await webhook.POST(form('HELP'))
  const helpXml = await helpRes.text()
  ok('a bare HELP gets the identification reply as the webhook TwiML (delivered regardless of opt-out state)',
    helpRes.status === 200 && helpRes.headers.get('content-type') === 'text/xml' &&
      /<Message>Test Brand: for help call 555\. Reply STOP to opt out\.<\/Message>/.test(helpXml), helpXml)
  const otherRes = await webhook.POST(form('What time does it start?'))
  const otherXml = await otherRes.text()
  ok('a normal message still gets the empty TwiML ack (replies stay asynchronous through the gate)',
    otherRes.status === 200 && /<Response><\/Response>/.test(otherXml))
  if (savedToken !== undefined) process.env.TWILIO_AUTH_TOKEN = savedToken

  const inboundMod = await bundle('src/lib/comms/inbound.ts')
  const help = inboundMod.helpResponseBody()
  ok('the REAL help response identifies the business, gives a live contact, rates note, and the STOP instruction',
    /Markist Athelus/.test(help) && /361-717-4215/.test(help) && /mathelus@farmersagent\.com/.test(help) &&
      /Msg&data rates may apply/.test(help) && /Reply STOP to opt out/.test(help), help)
}

console.log(`\n${passed} checks passed.`)
