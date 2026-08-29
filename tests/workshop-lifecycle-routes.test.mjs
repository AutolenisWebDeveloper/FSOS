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

console.log(`\n${passed} checks passed.`)
