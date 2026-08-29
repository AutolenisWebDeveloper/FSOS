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

// WS-005: SMS quiet hours are RECIPIENT-local, resolved from the phone's NPA. To keep
// the real-clock arithmetic deterministic, pick a real NANP number whose zone's CURRENT
// local hour is inside/outside the 9-20 window. NANP zones span UTC-11..UTC+10, so both
// bands are always reachable.
const NPA_CANDIDATES = [
  ['+16845550100', 'Pacific/Pago_Pago'], ['+18085550100', 'Pacific/Honolulu'],
  ['+19075550100', 'America/Anchorage'], ['+12065550100', 'America/Los_Angeles'],
  ['+16025550100', 'America/Phoenix'], ['+13035550100', 'America/Denver'],
  ['+12145550100', 'America/Chicago'], ['+12125550100', 'America/New_York'],
  ['+17875550100', 'America/Puerto_Rico'], ['+19025550100', 'America/Halifax'],
  ['+16715550100', 'Pacific/Guam'],
]
function localHourIn(zone) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
}
function phoneWithLocalHour(inWindow) {
  for (const [phone, zone] of NPA_CANDIDATES) {
    const h = localHourIn(zone)
    if (inWindow ? h >= 9 && h < 20 : h < 9 || h >= 20) return { phone, zone, hour: h }
  }
  throw new Error('no NANP candidate matched the requested window — impossible by construction')
}
// The venue zone stays a fixture detail; SMS decisions must IGNORE it entirely.
function venueZone() { return 'America/Chicago' }

const REG = {
  reg_id: 'reg-1', session_id: 'sess-1', workshop_id: 'w-1', name: 'Alex Rivera',
  email: 'alex@example.com', phone: '+12145550188', consent_channels: ['email', 'sms'],
  join_url: null, created_at: '2026-08-01T00:00:00Z', status: 'registered',
  lead_converted_at: null, referral_id: null,
}
const regWithPhone = (phone) => ({ ...REG, phone })
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
    reg: REG, workshop: WORKSHOP, session: session(venueZone()), kind: 'reminder_1h', channel: 'email', config: CONFIG,
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

console.log('\nQuiet-hours defers SMS in the RECIPIENT zone, BEFORE the gate (WS-005/WS-065)')
{
  globalThis.__gateCalls = []
  globalThis.__wsAuditCalls = []
  const out = phoneWithLocalHour(false) // a real NPA whose zone is OUTSIDE 9-20 right now
  const db = fakeDb({
    workshop_message_log: [null, { id: 'log-2' }],
    workshop_message_templates: [TPL_SMS],
    workshop_disclosure_configs: [DISCLOSURE_OK],
    workshop_consent_events: [{ action: 'granted' }],
  })
  const status = await engine.sendWorkshopMessage(db, {
    // Venue zone is Chicago regardless — the decision must come from the PHONE.
    reg: regWithPhone(out.phone), workshop: WORKSHOP, session: session(venueZone()), kind: 'reminder_1h', channel: 'sms', config: CONFIG,
  })
  ok(`recipient-local ${out.hour}:00 (${out.zone}) → deferred, venue zone ignored`, status === 'deferred')
  ok('the gate was NOT invoked for the deferred send', globalThis.__gateCalls.length === 0)
  const finalize = db.calls.find((c) => c.table === 'workshop_message_log' && c.method === 'update')
  ok('the deferral is durably recorded on the claim row',
    !!finalize && finalize.payload.status === 'deferred' && finalize.payload.gate_blocked_step === 'quiet_hours')
  ok('the deferral writes an audit row like its siblings (WS-065)',
    globalThis.__wsAuditCalls.some((a) => a.action === 'comms.deferred' && a.diff?.reason === 'outside_quiet_hours'))

  // And the mirror: an IN-window recipient sends even at a weird venue hour.
  globalThis.__gateCalls = []
  const inw = phoneWithLocalHour(true)
  const db2 = fakeDb({
    workshop_message_log: [null, { id: 'log-2b' }],
    workshop_message_templates: [TPL_SMS],
    workshop_disclosure_configs: [DISCLOSURE_OK],
    workshop_consent_events: [{ action: 'granted' }],
  })
  const status2 = await engine.sendWorkshopMessage(db2, {
    reg: regWithPhone(inw.phone), workshop: WORKSHOP, session: session(venueZone()), kind: 'reminder_1h', channel: 'sms', config: CONFIG,
  })
  ok(`recipient-local ${inw.hour}:00 (${inw.zone}) → dispatched through the gate`, status2 === 'sent' && globalThis.__gateCalls.length === 1)
  ok('the gate offset is the RECIPIENT offset (matches the picked zone hour)',
    ((new Date().getUTCHours() + globalThis.__gateCalls[0].utcOffsetHours + 24) % 24) === localHourIn(inw.zone))
}

console.log('\nUnresolvable recipient zone fails CLOSED (WS-005: no default, no send)')
{
  globalThis.__gateCalls = []
  globalThis.__wsAuditCalls = []
  const db = fakeDb({
    workshop_message_log: [null, { id: 'log-2c' }],
    workshop_message_templates: [TPL_SMS],
    workshop_disclosure_configs: [DISCLOSURE_OK],
    workshop_consent_events: [{ action: 'granted' }],
  })
  const status = await engine.sendWorkshopMessage(db, {
    reg: regWithPhone('+18005551234'), workshop: WORKSHOP, session: session(venueZone()), kind: 'reminder_1h', channel: 'sms', config: CONFIG,
  })
  ok('toll-free/unknown NPA → deferred with recipient_tz_unresolved, never sent', status === 'deferred')
  ok('no gate call under an unresolved zone', globalThis.__gateCalls.length === 0)
  ok('the fail-closed deferral is audited',
    globalThis.__wsAuditCalls.some((a) => a.action === 'comms.deferred' && a.diff?.reason === 'recipient_tz_unresolved'))
}

console.log('\nUnknown merge tokens pass through UNRESOLVED (WS-032: gate fail-closed restored)')
{
  globalThis.__gateCalls = []
  const db = fakeDb({
    workshop_message_log: [null, { id: 'log-2d' }],
    workshop_message_templates: [{ ...TPL, body: 'Hi {{name}} — {{bogus_token}} at {{starts_local}}.' }],
    workshop_consent_events: [{ action: 'granted' }],
  })
  await engine.sendWorkshopMessage(db, {
    reg: REG, workshop: WORKSHOP, session: session(venueZone()), kind: 'reminder_1h', channel: 'email', config: CONFIG,
  })
  ok('the unknown token reaches the gate INTACT for its personalization step to block',
    globalThis.__gateCalls.length === 1 && /\{\{bogus_token\}\}/.test(globalThis.__gateCalls[0].body))
  ok('known tokens are still substituted around it', !/\{\{starts_local\}\}/.test(globalThis.__gateCalls[0].body))
}

console.log('\nConfig read error fails CLOSED (WS-068: an unreadable kill switch disables)')
{
  globalThis.__gateCalls = []
  const db = fakeDb({ workshop_comms_config: [{ __throw: 'transient config read failure' }] })
  const { installDb: _install } = await import('./helpers/workshop-harness.mjs')
  _install(db)
  const res = await engine.runReminderPass()
  _install(null)
  ok('an unreadable config row disables the engine for the tick', res && res.ok === true && /disabled/.test(String(res.note ?? '')))
  ok('nothing was selected or sent under the failed config read',
    !db.calls.some((c) => c.table === 'workshop_sessions') && globalThis.__gateCalls.length === 0)
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
    reg: REG, workshop: WORKSHOP, session: session(venueZone()), kind: 'reminder_1h', channel: 'email', config: CONFIG,
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
    reg: REG, workshop: WORKSHOP, session: session(venueZone()), kind: 'reminder_1h', channel: 'email', config: CONFIG,
  })
  ok('no sendable template → deferred (template_not_approved), never sent', status === 'deferred')
  ok('the gate was NOT invoked without an approved template', globalThis.__gateCalls.length === 0)
}

console.log('\nIdempotency claim — terminal rows absorb, overlapping claim loss skips')
{
  globalThis.__gateCalls = []
  const db = fakeDb({ workshop_message_log: [{ id: 'log-5', status: 'sent', attempts: 1 }] })
  const status = await engine.sendWorkshopMessage(db, {
    reg: REG, workshop: WORKSHOP, session: session(venueZone()), kind: 'reminder_1h', channel: 'email', config: CONFIG,
  })
  ok('an already-sent slot returns sent without re-dispatch', status === 'sent' && globalThis.__gateCalls.length === 0)

  const dbLost = fakeDb({ workshop_message_log: [null, null] })   // insert loses the race → null
  const lost = await engine.sendWorkshopMessage(dbLost, {
    reg: REG, workshop: WORKSHOP, session: session(venueZone()), kind: 'reminder_1h', channel: 'email', config: CONFIG,
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
