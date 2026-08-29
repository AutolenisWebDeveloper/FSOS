// REMOVAL-GUARD (Batch 0, owner directive item 3): the workshop engine's delivery
// guarantees asserted by EXECUTING sendWorkshopMessage / the pass selectors with a
// recording stub at the ONE production boundary (`@/lib/comms/send`). Deleting or
// bypassing the sendThroughGate call — while keeping every comment and import — FAILS
// this file; editing a comment cannot satisfy it. Replaces the §11a pattern-B regexes
// that the old workshop-comms.test.mjs Part 3 matched against comments/imports.
//
// DB-free: the db is the harness's scripted PostgREST-chain fake, so this runs in the
// unit suite. The same behaviors against a REAL Postgres live in the pinned
// workshop-guarantee-*.test.mjs files (rls suite).
// Run: node tests/workshop-engine-invocation.test.mjs
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, fakeDb, installDb } from './helpers/workshop-harness.mjs'

let passed = 0
const ok = (name, cond, extra) => { assert.ok(cond, `${name}${extra ? `\n${extra}` : ''}`); console.log(`  ✓ ${name}`); passed++ }

// ── Recording stub for the ONE send boundary ────────────────────────────────────
globalThis.__gateCalls = []
globalThis.__gateResult = { sent: true, gate: { blockedStep: null }, messageId: 'cm-1', reason: null }
const stubDir = mkdtempSync(join(tmpdir(), 'fsos-gate-stub-'))
process.on('exit', () => { try { rmSync(stubDir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const gateStub = join(stubDir, 'send-stub.mjs')
writeFileSync(gateStub, `
export async function sendThroughGate(ctx) {
  globalThis.__gateCalls.push(ctx)
  return globalThis.__gateResult
}
export async function isTemplateApproved() { return true }
`)

const engine = await bundle('src/lib/workshops/comms-engine.ts', { aliases: { '@/lib/comms/send': gateStub } })

// An IANA zone whose CURRENT local hour equals `wantHour`, so the engine's real
// quiet-hours arithmetic runs deterministically against the real clock.
function zoneAtLocalHour(wantHour) {
  const utcHour = new Date().getUTCHours()
  let offset = (wantHour - utcHour + 24) % 24
  if (offset > 12) offset -= 24
  // POSIX-style Etc/GMT zones are sign-INVERTED: Etc/GMT-5 means UTC+5.
  return offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
}

const REG = {
  reg_id: 'reg-1', session_id: 'sess-1', workshop_id: 'w-1', name: 'Alex Rivera',
  email: 'alex@example.com', phone: '+12145550188', consent_channels: ['email', 'sms'],
  join_url: null, created_at: '2026-08-01T00:00:00Z', status: 'registered',
  lead_converted_at: null, referral_id: null,
}
const WORKSHOP = { workshop_id: 'w-1', title: 'Retirement Readiness 101', slug: 'rr-101', is_security: false, status: 'published' }
const CONFIG = {
  enabled: true, reminder_offsets_minutes: [10080, 1440, 60], confirmation_enabled: true,
  nurture_delay_minutes: 180, sender_physical_address: '123 Main St, McKinney TX 75070',
  scores: { score_attended: 15, score_engaged: 25, score_no_show: -5, score_registered_no_show: -2, score_replay_viewed: 10 },
}
const TPL = { id: 'wmt-1', subject: 'Reminder: {{workshop_title}}', body: 'Hi {{name}} — {{workshop_title}} starts {{starts_local}}.', comm_template_id: 'tpl-1', disclosure_config_id: null, status: 'approved', active: true }
// SMS sendability additionally requires an APPROVED (non-assumption) sms disclosure.
const TPL_SMS = { ...TPL, id: 'wmt-2', subject: null, disclosure_config_id: 'disc-1' }
const DISCLOSURE_OK = { is_assumption: false, approved_by: 'FFS Principal (test)' }
const session = (tz) => ({ id: 'sess-1', workshop_id: 'w-1', starts_at: '2026-09-01T18:00:00Z', ends_at: null, timezone: tz, venue_name: 'Hall', venue_address: null, status: 'scheduled' })

console.log('\nsendWorkshopMessage — the gate invocation IS the guarantee (removal-guard)')
{
  globalThis.__gateCalls = []
  const db = fakeDb({
    workshop_message_log: [null, { id: 'log-1' }],   // no existing row → insert claim wins
    workshop_message_templates: [TPL],
    workshop_consent_events: [{ action: 'granted' }],
  })
  const status = await engine.sendWorkshopMessage(db, {
    reg: REG, workshop: WORKSHOP, session: session(zoneAtLocalHour(13)), kind: 'reminder_1h', channel: 'email', config: CONFIG,
  })
  ok('a fully-consented, approved-template send returns sent', status === 'sent')
  ok('sendThroughGate was invoked EXACTLY once — delete the call and this fails',
    globalThis.__gateCalls.length === 1)
  const ctx = globalThis.__gateCalls[0]
  ok('gate receives the approved comm_templates handle (step-4 input)', ctx.templateId === 'tpl-1')
  ok('gate receives the durable consent fact (step-1 input)', ctx.durableConsentGranted === true)
  ok('gate receives a numeric utcOffsetHours for quiet hours (step-2 input)', typeof ctx.utcOffsetHours === 'number')
  ok('gate receives the registration entity for audit lineage', ctx.entity?.type === 'workshop_registration' && ctx.entity?.id === 'reg-1')
  ok('securities flag is explicitly false on the excluded-population path', ctx.isSecurity === false)
  ok('workshop tokens are substituted BEFORE the gate sees the body', /Retirement Readiness 101/.test(ctx.body) && !/\{\{workshop_title\}\}/.test(ctx.body))
  const finalize = db.calls.find((c) => c.table === 'workshop_message_log' && c.method === 'update')
  ok('the claim row is finalized sent with the dispatched message id',
    !!finalize && finalize.payload.status === 'sent' && finalize.payload.comm_message_id === 'cm-1')
}

console.log('\nQuiet-hours pre-check defers SMS BEFORE the gate (no dispatch attempt)')
{
  globalThis.__gateCalls = []
  const db = fakeDb({
    workshop_message_log: [null, { id: 'log-2' }],
    workshop_message_templates: [TPL_SMS],
    workshop_disclosure_configs: [DISCLOSURE_OK],
    workshop_consent_events: [{ action: 'granted' }],
  })
  const status = await engine.sendWorkshopMessage(db, {
    reg: REG, workshop: WORKSHOP, session: session(zoneAtLocalHour(3)), kind: 'reminder_1h', channel: 'sms', config: CONFIG,
  })
  ok('3am local SMS → deferred (retry next tick), never sent', status === 'deferred')
  ok('the gate was NOT invoked for the deferred send', globalThis.__gateCalls.length === 0)
  const finalize = db.calls.find((c) => c.table === 'workshop_message_log' && c.method === 'update')
  ok('the deferral is durably recorded on the claim row',
    !!finalize && finalize.payload.status === 'deferred' && finalize.payload.gate_blocked_step === 'quiet_hours')
}

console.log('\nDurable consent guard blocks BEFORE the gate')
{
  globalThis.__gateCalls = []
  const db = fakeDb({
    workshop_message_log: [null, { id: 'log-3' }],
    workshop_message_templates: [TPL],
    workshop_consent_events: [{ action: 'revoked' }],   // latest action wins
  })
  const status = await engine.sendWorkshopMessage(db, {
    reg: REG, workshop: WORKSHOP, session: session(zoneAtLocalHour(13)), kind: 'reminder_1h', channel: 'email', config: CONFIG,
  })
  ok('latest action revoked → terminally blocked (no_channel_consent)', status === 'blocked')
  ok('the gate was NOT invoked for the unconsented send', globalThis.__gateCalls.length === 0)
}

console.log('\nUnapproved/missing template defers BEFORE the gate (placeholder can never send)')
{
  globalThis.__gateCalls = []
  const db = fakeDb({
    workshop_message_log: [null, { id: 'log-4' }],
    workshop_message_templates: [null],   // nothing approved+active+handled
  })
  const status = await engine.sendWorkshopMessage(db, {
    reg: REG, workshop: WORKSHOP, session: session(zoneAtLocalHour(13)), kind: 'reminder_1h', channel: 'email', config: CONFIG,
  })
  ok('no sendable template → deferred (template_not_approved), never sent', status === 'deferred')
  ok('the gate was NOT invoked without an approved template', globalThis.__gateCalls.length === 0)
}

console.log('\nIdempotency claim — terminal rows absorb, overlapping claim loss skips')
{
  globalThis.__gateCalls = []
  const db = fakeDb({ workshop_message_log: [{ id: 'log-5', status: 'sent', attempts: 1 }] })
  const status = await engine.sendWorkshopMessage(db, {
    reg: REG, workshop: WORKSHOP, session: session(zoneAtLocalHour(13)), kind: 'reminder_1h', channel: 'email', config: CONFIG,
  })
  ok('an already-sent slot returns sent without re-dispatch', status === 'sent' && globalThis.__gateCalls.length === 0)

  const dbLost = fakeDb({ workshop_message_log: [null, null] })   // insert loses the race → null
  const lost = await engine.sendWorkshopMessage(dbLost, {
    reg: REG, workshop: WORKSHOP, session: session(zoneAtLocalHour(13)), kind: 'reminder_1h', channel: 'email', config: CONFIG,
  })
  ok('losing the atomic claim race → skipped, no dispatch', lost === 'skipped' && globalThis.__gateCalls.length === 0)
}

console.log('\nSecurities firewall — is_security workshops are EXECUTED out of the reminder pass')
{
  // A published securities workshop's session is returned by the selection query; the
  // engine must skip it in JS — no registration query, no gate call.
  globalThis.__gateCalls = []
  const dbSec = fakeDb({
    workshop_comms_config: [null],
    workshop_sessions: [[{ id: 's-sec', workshop_id: 'w-sec', starts_at: new Date(Date.now() + 30 * 60000).toISOString(), ends_at: null, timezone: 'Etc/GMT', venue_name: null, venue_address: null, status: 'scheduled', workshop: { workshop_id: 'w-sec', title: 'Securities Workshop', slug: 's', is_security: true, status: 'published' } }]],
  })
  installDb(dbSec) // runReminderPass builds its own db via the stubbed getDb()
  const res = await engine.runReminderPass()
  installDb(null)
  ok('the pass completes over the securities fixture', res && res.ok === true, JSON.stringify(res))
  ok('the securities session never reaches the registration query',
    !dbSec.calls.some((c) => c.table === 'workshop_registrations'), JSON.stringify(dbSec.calls.map((c) => c.table)))
  ok('the securities session never reaches the gate', globalThis.__gateCalls.length === 0)
}

console.log(`\n${passed} checks passed.`)
