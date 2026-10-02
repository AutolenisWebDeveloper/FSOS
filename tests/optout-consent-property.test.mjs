// PROPERTY TEST — opt-out and consent ordering (owner, 2026-10-02, before merge). Every sequence of
// up to 4 events per channel, drawn from STOP, START, unsubscribe link, one-click unsubscribe,
// web/portal opt-out, operator opt-out, bounce, complaint, DNC add and documented re-consent, is
// replayed against the REAL writers and the REAL send-gate readers, and after every event:
//
//   I1  appending an opt-out never makes a send allowed (and an opt-out on this channel blocks);
//   I2  START makes a send allowed only when the latest blocking event is a STOP and consent was on
//       record before START — granted before that STOP, or documented by a re-consent after it.
//       START itself never creates consent;
//   I3  START never lifts a DNC add, bounce, complaint, unsubscribe, web/portal or operator opt-out
//       (one not later superseded by a documented re-consent), and never touches a non-keyword DNC row;
//   I4  no event deletes or relabels an earlier opt-out record: every DNC row keeps its id and its
//       reason, and every contact-level revoke row stays exactly as written.
//
// Why exhaustive and not examples: all three defects the final review found were event-ORDER bugs
// (a later opt-out not re-arming a START-lifted row; START creating consent; a STOP relabelling an
// unsubscribe as START-liftable) that the example tests did not reach.
//
// Exhaustive, not sampled: 10 events, lengths 1–4 → 11,110 sequences per (channel × recipient ×
// initial consent), walked depth-first with a state snapshot per node. Recipient = an existing
// household member (member consent store) or a bare contact (contact-level store); initial consent
// on record or not. Cross-channel events (one-click, bounce and complaint are email-only) are applied
// to the recipient's email address when the channel under test is SMS.
//
// What runs for real (esbuild bundles of src/, only getDb / writeAudit / auth / portal scope stubbed):
//   STOP, START          → processInbound (src/lib/comms/inbound.ts)
//   unsubscribe link     → POST /api/consent/opt-out (the /unsubscribe page) → suppressContact
//   one-click            → POST /api/comms/unsubscribe with a signed List-Unsubscribe URL
//   web/portal opt-out   → POST /api/public/consent (bare contact) | POST /api/client/consent (member)
//   operator opt-out     → revokeConsentForMembers (members only — a bare contact has no member row)
//   bounce, complaint    → applyDeliverabilitySuppression (src/lib/comms/deliverability.ts)
//   DNC add              → armDncEntry (src/lib/comms/opt-out.ts), the shared DNC writer
//   re-consent           → POST /api/client/consent granted (member) | captureBookingSmsConsent (SMS
//                          contact) | a documented comm_contact_consents grant (email contact)
//   "send allowed"       → resolveDispatchPolicy with the production consent / DNC / revoke readers
//                          (defaultPolicyDeps); every unrelated reader is pinned permissive.
// The database is tests/helpers/memdb.mjs (stateful, in memory) — code behavior, not Postgres.
//
// Run: node tests/optout-consent-property.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, installDb, makeReq, resetAudit } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

// ── Environment: no network, deterministic secrets, a controllable clock ──────────────────────────
process.env.UNSUBSCRIBE_SECRET = 'property-test-secret'
process.env.NEXT_PUBLIC_SITE_URL = 'https://fsos.test'
globalThis.fetch = async () => { throw new Error('network disabled in the property test') }
const RealDate = Date
const clock = { t: RealDate.UTC(2026, 0, 15, 12, 0) }
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(clock.t); else super(...a) }
  static now() { return clock.t }
}
globalThis.Date = FakeDate
const iso = () => new RealDate(clock.t).toISOString()

// ── Stubs for the two route-auth seams ───────────────────────────────────────────────────────────
const stubDir = mkdtempSync(join(tmpdir(), 'fsos-optout-prop-'))
process.on('exit', () => { try { rmSync(stubDir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const authStub = join(stubDir, 'auth.mjs')
writeFileSync(authStub, `
export async function requireApiRole() { return { ok: true, session: { sub: 'client-user', role: 'client' } } }
export async function requirePermission() { return { ok: true } }
export function actorOf() { return 'client:client-user' }`)
const scopeStub = join(stubDir, 'scope.mjs')
writeFileSync(scopeStub, `export async function householdIdFor() { return 'h1' }
export async function agencyIdsFor() { return [] }
export async function compDisclosureEnabled() { return false }`)

const inbound = await bundle('src/lib/comms/inbound.ts')
const optOut = await bundle('src/lib/comms/opt-out.ts')
const unsub = await bundle('src/lib/comms/unsubscribe.ts')
const deliver = await bundle('src/lib/comms/deliverability.ts')
// The bulk revoke builds its own audit rows, so it needs the real audit module (writes land in memdb).
const revokeRun = await bundle('src/lib/comms/consent-revoke-run.ts', { aliases: { '@/lib/audit/log': join(process.cwd(), 'src/lib/audit/log.ts') } })
const booking = await bundle('src/lib/booking/sms-consent.ts')
const policy = await bundle('src/lib/comms/dispatch-policy.ts')
const optOutPage = await bundle('src/app/api/consent/opt-out/route.ts')
const oneClick = await bundle('src/app/api/comms/unsubscribe/route.ts')
const publicConsent = await bundle('src/app/api/public/consent/route.ts')
const clientConsent = await bundle('src/app/api/client/consent/route.ts', {
  aliases: { '@/lib/auth/api': authStub, '@/lib/portal/scope': scopeStub },
})

const PHONE = '+12145550147'
const EMAIL = 'pat@example.com'
const addrOf = (ch) => (ch === 'sms' ? PHONE : EMAIL)

// ── The send the gate is asked about: a marketing-shaped message on the channel under test ───────
const PERMISSIVE = {
  templateApproved: async () => true,
  aiPolicyApproved: async () => true,
  suppression: async () => ({ suppressed: false, resolved: true }),
  withinBusinessHours: async () => true,
  recipientLocation: async () => ({ phone: PHONE, zip: '75201' }),
  hoursWindow: async () => null,
  sendPolicy: async () => ({ consentForPurpose: null, frequency: { allowed: true }, collision: { allowed: true } }),
  smsLive: () => true,
  conversationIsSecurity: async () => false,
}
const deps = { ...policy.defaultPolicyDeps, ...PERMISSIVE }
const GATE_NOW = new RealDate(RealDate.UTC(2026, 0, 15, 18, 0)) // Thursday 12:00 Central
async function allowed(ch) {
  const d = await policy.resolveDispatchPolicy(
    { channel: ch, to: addrOf(ch), body: 'Your annual review window is open.', actor: 'test', templateKind: 'stored', templateId: 't1' },
    deps,
    GATE_NOW,
  )
  if (!d.gate.allowed) {
    assert.ok(['consent', 'dnc'].includes(d.gate.blockedStep), `harness: unexpected block ${d.gate.blockedStep} — ${d.gate.reason}`)
  }
  return d.gate.allowed
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────
const EVENTS = ['STOP', 'START', 'UNSUB_LINK', 'ONE_CLICK', 'WEB_PORTAL', 'OPERATOR', 'BOUNCE', 'COMPLAINT', 'DNC_ADD', 'RECONSENT']
const OPT_OUTS = new Set(['STOP', 'UNSUB_LINK', 'ONE_CLICK', 'WEB_PORTAL', 'OPERATOR', 'BOUNCE', 'COMPLAINT', 'DNC_ADD'])
const EMAIL_ONLY = new Set(['ONE_CLICK', 'BOUNCE', 'COMPLAINT'])
/** The channel an event acts on, given the channel under test. */
const eventChannel = (e, ch) => (EMAIL_ONLY.has(e) ? 'email' : ch)
/** Whether event e is an effective opt-out ON the channel under test, for this recipient. */
const appliesHere = (e, ch, cfg) => OPT_OUTS.has(e) && eventChannel(e, ch) === ch && !(e === 'OPERATOR' && !cfg.member)

let ipSeq = 0
async function apply(e, ch, cfg, n) {
  const evCh = eventChannel(e, ch)
  const addr = addrOf(evCh)
  const ok = (cond, what) => assert.ok(cond, `harness: ${e} did not complete (${what})`)
  switch (e) {
    case 'STOP':
    case 'START': {
      const r = await inbound.processInbound({ channel: evCh, from: addr, body: e, provider: evCh === 'sms' ? 'twilio' : 'resend', providerId: `pid-${n}-${clock.t}` })
      if (e === 'STOP') ok(r.optedOut === true, 'optedOut')
      return
    }
    case 'UNSUB_LINK': {
      const res = await optOutPage.POST(makeReq('/api/consent/opt-out', { body: { contact: addr, channel: evCh } }))
      ok(res.status === 200, `status ${res.status}`)
      return
    }
    case 'ONE_CLICK': {
      const header = unsub.emailListUnsubscribeHeaders(EMAIL)['List-Unsubscribe']
      const url = /<(https:[^>]+)>/.exec(header)?.[1]
      ok(!!url, 'signed List-Unsubscribe URL')
      const req = makeReq(url, { body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
      req.nextUrl = new URL(req.url) // NextRequest's parsed URL, which the route reads
      const res = await oneClick.POST(req)
      ok(res.status < 400, `status ${res.status}`)
      return
    }
    case 'WEB_PORTAL': {
      const res = cfg.member
        ? await clientConsent.POST(makeReq('/api/client/consent', { body: { channel: evCh, status: 'revoked' } }))
        : await publicConsent.POST(makeReq('/api/public/consent', { body: { contact: addr, channel: evCh, action: 'opt_out' }, headers: { 'x-forwarded-for': `10.9.${(++ipSeq >> 8) & 255}.${ipSeq & 255}` } }))
      ok(res.status === 200, `status ${res.status}`)
      return
    }
    case 'OPERATOR': {
      if (!cfg.member) return // no member row to revoke; an operator acts on members
      await revokeRun.revokeConsentForMembers({ memberIds: ['m1'], channels: [evCh], source: 'operator', disclosure: 'Operator opt-out (client asked by phone)', actor: 'fsa:operator' })
      return
    }
    case 'BOUNCE':
    case 'COMPLAINT': {
      const r = await deliver.applyDeliverabilitySuppression(
        e === 'BOUNCE' ? { event: 'bounced', bounce: { type: 'Permanent', subType: 'General' }, email: EMAIL } : { event: 'complained', email: EMAIL },
      )
      ok(r.suppressed === true, 'suppressed')
      return
    }
    case 'DNC_ADD': {
      const r = await optOut.armDncEntry({ contact: addr, channel: evCh, reason: 'operator DNC add' })
      ok(r.ok === true, 'armDncEntry ok')
      return
    }
    case 'RECONSENT': {
      if (cfg.member) {
        const res = await clientConsent.POST(makeReq('/api/client/consent', { body: { channel: evCh, status: 'granted' } }))
        ok(res.status === 200, `status ${res.status}`)
      } else if (evCh === 'sms') {
        const r = await booking.captureBookingSmsConsent({ contactId: 'c1', appointmentId: `a-${n}`, phone: PHONE, capturedAt: iso() })
        ok(r.recorded === true, 'recorded')
      } else {
        globalThis.__wsDb.seed('comm_contact_consents', [{ contact: EMAIL, channel: 'email', action: 'granted', consent_text: 'Email updates checkbox on the contact form', consent_version: 'email-v1', captured_at: iso() }])
      }
      return
    }
  }
  throw new Error(`unknown event ${e}`)
}

// ── Opt-out records, for I4 ───────────────────────────────────────────────────────────────────────
function optOutRecords(db) {
  return {
    dnc: db.rows('dnc_entries').map((r) => ({ id: r.id, contact: r.contact, channel: r.channel, reason: r.reason, lifted_at: r.lifted_at ?? null })),
    revokes: db.rows('comm_contact_consents').filter((r) => r.action === 'revoked').map((r) => JSON.stringify(r)),
  }
}

// ── The walk ──────────────────────────────────────────────────────────────────────────────────────
const CONFIGS = []
for (const ch of ['sms', 'email']) for (const member of [true, false]) for (const consent of [true, false]) CONFIGS.push({ ch, member, consent })

let nodes = 0
let checks = 0
let restoredByStart = 0
// One shortest example per distinct violation class, plus a count — readable even when a defect
// shows up in thousands of sequences.
const failures = new Map()
const fail = (cfg, seq, msg) => {
  const key = `${cfg.ch}|${msg.replace(/\(message [^)]*\)/g, '(…)')}`
  const ex = `[${cfg.ch} ${cfg.member ? 'member' : 'contact'} ${cfg.consent ? 'consent' : 'no-consent'}] ${seq.join(' → ')}`
  const f = failures.get(key)
  if (!f) failures.set(key, { msg: key.split('|')[1], ex, n: 1, len: seq.length })
  else { f.n++; if (seq.length < f.len) { f.ex = ex; f.len = seq.length } }
}

function seedConfig(db, cfg) {
  db.seed('households', [{ id: 'h1', zip: '75201' }])
  if (cfg.member) db.seed('household_members', [{ id: 'm1', household_id: 'h1', full_name: 'Pat Example', phone: PHONE, email: EMAIL }])
  if (cfg.consent) {
    for (const ch of ['sms', 'email']) {
      if (cfg.member) db.seed('consents', [{ member_id: 'm1', household_id: 'h1', channel: ch, status: 'granted', source: 'intake', captured_at: iso() }])
      else db.seed('comm_contact_consents', [{ contact: addrOf(ch), channel: ch, action: 'granted', consent_text: 'Intake form consent', consent_version: 'v1', captured_at: iso() }])
    }
  }
}

/** History facts the invariants are stated over (channel-under-test events only). */
function facts(seq, cfg) {
  let latestBlocking = null
  let latestBlockingIdx = -1
  // An operator opt-out is a member-store revoke; a later documented re-consent re-grants that store,
  // so it no longer blocks. Every other opt-out is a DNC row, which re-consent does not lift.
  const superseded = (i) => seq[i] === 'OPERATOR' && seq.slice(i + 1).includes('RECONSENT')
  for (let i = 0; i < seq.length; i++) if (appliesHere(seq[i], cfg.ch, cfg) && !superseded(i)) { latestBlocking = seq[i]; latestBlockingIdx = i }
  const grantBefore = (idx) => cfg.consent || seq.slice(0, idx).includes('RECONSENT')
  return { latestBlocking, latestBlockingIdx, grantBefore }
}

async function walk(db, cfg, seq, parentAllowed, parentRecords) {
  for (const e of EVENTS) {
    const snap = db.snapshot()
    const t0 = clock.t
    clock.t += 60_000
    const next = [...seq, e]
    nodes++
    await apply(e, cfg.ch, cfg, nodes)
    const now = await allowed(cfg.ch)
    const records = optOutRecords(db)

    // I1 — an opt-out never makes a send allowed; one on this channel blocks.
    if (OPT_OUTS.has(e)) {
      checks++
      if (now && !parentAllowed) fail(cfg, next, 'I1: an opt-out made the send allowed')
      if (now && appliesHere(e, cfg.ch, cfg)) fail(cfg, next, 'I1: the opt-out did not block the send')
    }
    // I2 / I3 — what START may and may not do.
    if (e === 'START') {
      checks++
      if (now && !parentAllowed) {
        restoredByStart++
        const f = facts(seq, cfg)
        const consentOnRecord = f.latestBlocking === 'STOP' && (f.grantBefore(f.latestBlockingIdx) || seq.slice(f.latestBlockingIdx + 1).includes('RECONSENT'))
        if (f.latestBlocking !== 'STOP') fail(cfg, next, `I2: START allowed a send whose latest blocking event is ${f.latestBlocking}`)
        else if (!consentOnRecord) fail(cfg, next, 'I2: START allowed a send with no consent on record (START created consent)')
        for (let i = 0; i < seq.length; i++) {
          const x = seq[i]
          if (x === 'STOP' || !appliesHere(x, cfg.ch, cfg)) continue
          if (!seq.slice(i + 1).includes('RECONSENT')) fail(cfg, next, `I3: START lifted ${x}`)
        }
      }
      for (const r of records.dnc) {
        const before = parentRecords.dnc.find((p) => p.id === r.id)
        if (before && before.lifted_at !== r.lifted_at && !/^(inbound STOP|Twilio ErrorCode 21610)/.test(r.reason ?? '')) {
          fail(cfg, next, `I3: START lifted a non-keyword DNC row (${r.reason})`)
        }
      }
    }
    // I4 — no event deletes or relabels an earlier opt-out record.
    checks++
    for (const p of parentRecords.dnc) {
      const r = records.dnc.find((x) => x.id === p.id)
      if (!r) fail(cfg, next, `I4: ${e} deleted a DNC row (${p.reason})`)
      else if (r.reason !== p.reason) fail(cfg, next, `I4: ${e} relabelled a DNC row "${p.reason}" → "${r.reason}"`)
    }
    for (const p of parentRecords.revokes) if (!records.revokes.includes(p)) fail(cfg, next, `I4: ${e} deleted or rewrote a contact-level revoke row`)

    if (next.length < 4) await walk(db, cfg, next, now, records)
    db.restore(snap)
    clock.t = t0
    if (nodes % 2000 === 0) resetAudit()
  }
}

const started = RealDate.now()
console.log('Every sequence of up to 4 opt-out / consent events, per channel × recipient × initial consent')
for (const cfg of CONFIGS) {
  const db = memDb({ now: iso })
  installDb(db)
  seedConfig(db, cfg)
  const before = nodes
  const restoredBefore = restoredByStart
  const a0 = await allowed(cfg.ch)
  assert.equal(a0, cfg.consent, `harness: initial state ${cfg.consent ? 'should' : 'should not'} allow a send`)
  await walk(db, cfg, [], a0, optOutRecords(db))
  // Not vacuous: with consent on record, STOP → START must really restore sending somewhere.
  if (cfg.consent) assert.ok(restoredByStart > restoredBefore, `harness: START never restored a send for ${cfg.ch} ${cfg.member ? 'member' : 'contact'}`)
  console.log(`  ✓ ${cfg.ch.padEnd(5)} ${cfg.member ? 'member ' : 'contact'} ${cfg.consent ? 'consent   ' : 'no consent'} — ${nodes - before} sequences, ${restoredByStart - restoredBefore} restored by START`)
}

// The web opt-out key is normalized as the gate reads it (it was stored raw: a mixed-case email or a
// punctuated phone never matched the send).
console.log('\nWeb opt-out key normalization')
for (const [ch, typed] of [['email', 'Pat@Example.COM'], ['sms', '(214) 555-0147']]) {
  const db = memDb({ now: iso })
  installDb(db)
  seedConfig(db, { ch, member: false, consent: true })
  assert.equal(await allowed(ch), true)
  const res = await publicConsent.POST(makeReq('/api/public/consent', { body: { contact: typed, channel: ch, action: 'opt_out' }, headers: { 'x-forwarded-for': '10.250.0.1' } }))
  assert.equal(res.status, 200)
  assert.equal(await allowed(ch), false, `a web opt-out typed as "${typed}" must block ${ch}`)
  console.log(`  ✓ ${ch}: "${typed}" blocks the send`)
}

if (failures.size) {
  console.error(`\n✗ ${failures.size} distinct invariant violation(s):`)
  for (const f of [...failures.values()].sort((a, b) => a.msg.localeCompare(b.msg))) console.error(`   ${f.msg}  ×${f.n}\n      e.g. ${f.ex}`)
  process.exit(1)
}
console.log(`\nAll ${nodes} sequences (${checks} invariant checks) hold — ${((RealDate.now() - started) / 1000).toFixed(1)}s.`)
