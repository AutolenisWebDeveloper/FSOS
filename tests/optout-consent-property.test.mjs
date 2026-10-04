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
//       still in effect, and never lifts a non-keyword DNC row a re-consent has not cleared;
//   I4  no event deletes or relabels an earlier opt-out record: every DNC row keeps its id and its
//       reason, and every contact-level revoke row stays exactly as written;
//   I5  (owner, round 3) a documented re-consent on the channel clears the earlier opt-outs on it —
//       the send is allowed again — EXCEPT a hard bounce, which only re-verifying the address
//       clears; from then on START works normally for a later STOP (I2/I3 judge only the opt-outs
//       after the latest re-consent, and a hard bounce at any time).
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
//                          contact). A bare EMAIL contact has no documented-consent source in FSOS
//                          today, so there re-consent is not applicable (like operator for contacts)
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
/** Whether a documented re-consent source exists for this recipient on the channel under test. */
const reconsentApplies = (cfg) => cfg.member || cfg.ch === 'sms'

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
      }
      // A bare email contact: no FSOS source records documented email consent — nothing to do.
      return
    }
  }
  throw new Error(`unknown event ${e}`)
}

// ── Opt-out records, for I4 ───────────────────────────────────────────────────────────────────────
function optOutRecords(db) {
  return {
    dnc: db.rows('dnc_entries').map((r) => ({ id: r.id, contact: r.contact, channel: r.channel, reason: r.reason, lifted_at: r.lifted_at ?? null, lifted_reason: r.lifted_reason ?? null })),
    revokes: db.rows('comm_contact_consents').filter((r) => r.action === 'revoked').map((r) => JSON.stringify(r)),
  }
}

// ── The walk ──────────────────────────────────────────────────────────────────────────────────────
const CONFIGS = []
for (const ch of ['sms', 'email']) for (const member of [true, false]) for (const consent of [true, false]) CONFIGS.push({ ch, member, consent })

let nodes = 0
let checks = 0
let restoredByStart = 0
let clearedByReconsent = 0
let startAfterReconsent = 0
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
  // A documented re-consent clears every earlier opt-out on the channel (owner, round 3) — except a
  // hard bounce, which stays in effect whenever it happened.
  const lastRc = reconsentApplies(cfg) ? seq.lastIndexOf('RECONSENT') : -1
  const inEffect = (i) => i > lastRc || seq[i] === 'BOUNCE'
  for (let i = 0; i < seq.length; i++) if (appliesHere(seq[i], cfg.ch, cfg) && inEffect(i)) { latestBlocking = seq[i]; latestBlockingIdx = i }
  const grantBefore = (idx) => cfg.consent || (reconsentApplies(cfg) && seq.slice(0, idx).includes('RECONSENT'))
  return { latestBlocking, latestBlockingIdx, grantBefore, inEffect }
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
        // START working normally after a re-consent that cleared an earlier non-STOP opt-out.
        const rc = seq.lastIndexOf('RECONSENT')
        if (rc > 0 && seq.slice(0, rc).some((x) => x !== 'STOP' && appliesHere(x, cfg.ch, cfg))) startAfterReconsent++
        const f = facts(seq, cfg)
        const consentOnRecord = f.latestBlocking === 'STOP' && f.grantBefore(f.latestBlockingIdx)
        if (f.latestBlocking !== 'STOP') fail(cfg, next, `I2: START allowed a send whose latest blocking event is ${f.latestBlocking}`)
        else if (!consentOnRecord) fail(cfg, next, 'I2: START allowed a send with no consent on record (START created consent)')
        for (let i = 0; i < seq.length; i++) {
          const x = seq[i]
          if (x === 'STOP' || !appliesHere(x, cfg.ch, cfg)) continue
          if (f.inEffect(i)) fail(cfg, next, `I3: START lifted ${x}`)
        }
      }
      for (const r of records.dnc) {
        const before = parentRecords.dnc.find((p) => p.id === r.id)
        const clearedEarlier = (before?.lifted_reason ?? '').includes('documented re-consent')
        if (before && before.lifted_at !== r.lifted_at && !clearedEarlier && !/^(inbound STOP|Twilio ErrorCode 21610)/.test(r.reason ?? '')) {
          fail(cfg, next, `I3: START lifted a non-keyword DNC row a re-consent had not cleared (${r.reason})`)
        }
      }
    }
    // I5 — a documented re-consent clears the earlier opt-outs on the channel, except a hard bounce.
    if (e === 'RECONSENT' && reconsentApplies(cfg)) {
      checks++
      const bounced = cfg.ch === 'email' && seq.includes('BOUNCE')
      if (now && !parentAllowed) clearedByReconsent++
      if (bounced && now) fail(cfg, next, 'I5: a re-consent cleared a hard bounce')
      if (!bounced && !now) fail(cfg, next, 'I5: a documented re-consent did not clear the earlier opt-outs')
      for (const r of records.dnc) {
        const before = parentRecords.dnc.find((p) => p.id === r.id)
        if (before && r.reason === 'hard_bounce' && before.lifted_at !== r.lifted_at) fail(cfg, next, 'I5: a re-consent lifted a hard-bounce row')
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
  const clearedBefore = clearedByReconsent
  const startRcBefore = startAfterReconsent
  const a0 = await allowed(cfg.ch)
  assert.equal(a0, cfg.consent, `harness: initial state ${cfg.consent ? 'should' : 'should not'} allow a send`)
  await walk(db, cfg, [], a0, optOutRecords(db))
  // Not vacuous: with consent on record, STOP → START must really restore sending somewhere.
  if (cfg.consent) assert.ok(restoredByStart > restoredBefore, `harness: START never restored a send for ${cfg.ch} ${cfg.member ? 'member' : 'contact'}`)
  // Not vacuous: where a re-consent source exists, it must really clear opt-outs, and START must
  // really work again after it (owner, round 3).
  if (reconsentApplies(cfg)) {
    assert.ok(clearedByReconsent > clearedBefore, `harness: re-consent never cleared an opt-out (${cfg.ch} ${cfg.member ? 'member' : 'contact'})`)
    assert.ok(startAfterReconsent > startRcBefore, `harness: START never worked after a re-consent (${cfg.ch} ${cfg.member ? 'member' : 'contact'})`)
  }
  console.log(`  ✓ ${cfg.ch.padEnd(5)} ${cfg.member ? 'member ' : 'contact'} ${cfg.consent ? 'consent   ' : 'no consent'} — ${nodes - before} sequences, ${restoredByStart - restoredBefore} restored by START, ${clearedByReconsent - clearedBefore} cleared by re-consent, ${startAfterReconsent - startRcBefore} START-after-re-consent`)
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

// An 'all'-channel web opt-out covers both channels; an SMS re-consent clears SMS only — the email
// opt-out stays in force (a new email row carries the same reason; the 'all' row is lifted, not deleted).
console.log('\nRe-consent on one channel against an all-channel opt-out')
{
  const cfg = { ch: 'sms', member: false, consent: true }
  const db = memDb({ now: iso })
  installDb(db)
  seedConfig(db, cfg)
  clock.t += 60_000
  const res = await publicConsent.POST(makeReq('/api/public/consent', { body: { contact: PHONE, channel: 'all', action: 'opt_out' }, headers: { 'x-forwarded-for': '10.250.0.3' } }))
  assert.equal(res.status, 200)
  assert.equal(await allowed('sms'), false)
  clock.t += 60_000
  await apply('RECONSENT', 'sms', cfg, 900002)
  assert.equal(await allowed('sms'), true, 'SMS re-consent clears the SMS side')
  const rows = db.rows('dnc_entries')
  assert.ok(rows.some((r) => r.channel === 'all' && r.lifted_at), "the 'all' row is lifted, not deleted")
  assert.ok(rows.some((r) => r.channel === 'email' && r.reason === 'public opt-out' && !r.lifted_at), 'the email opt-out stays in force with its reason')
  console.log('  ✓ SMS cleared; the email opt-out stays (same reason, new row); nothing deleted')
}

// A lost evidence row must fail the web opt-out (review P1): that row is what keeps a later START
// from lifting the STOP-labelled DNC row the opt-out re-armed.
console.log('\nWeb opt-out evidence write failure')
{
  const cfg = { ch: 'sms', member: false, consent: true }
  const failEvidence = { on: false }
  const db = memDb({ now: iso, failOn: (st) => failEvidence.on && st.table === 'comm_contact_consents' && st.method === 'insert' })
  installDb(db)
  seedConfig(db, cfg)
  clock.t += 60_000; await apply('STOP', 'sms', cfg, 900001)
  failEvidence.on = true
  clock.t += 60_000
  const res = await publicConsent.POST(makeReq('/api/public/consent', { body: { contact: PHONE, channel: 'sms', action: 'opt_out' }, headers: { 'x-forwarded-for': '10.250.0.2' } }))
  failEvidence.on = false
  assert.equal(res.status, 500, 'a web opt-out whose evidence was lost must not report success')
  console.log('  ✓ the request fails (500) so the person can retry, instead of a silent 200')
}

if (failures.size) {
  console.error(`\n✗ ${failures.size} distinct invariant violation(s):`)
  for (const f of [...failures.values()].sort((a, b) => a.msg.localeCompare(b.msg))) console.error(`   ${f.msg}  ×${f.n}\n      e.g. ${f.ex}`)
  process.exit(1)
}
console.log(`\nAll ${nodes} sequences (${checks} invariant checks) hold — ${((RealDate.now() - started) / 1000).toFixed(1)}s.`)
