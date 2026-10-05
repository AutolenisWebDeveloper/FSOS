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
export function requirePermission() { return null }
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
const sessionStub = join(stubDir, 'session.mjs')
writeFileSync(sessionStub, `export async function getCurrentUserEmail() { return globalThis.__signedInEmail ?? 'pat@example.com' }`)
const sendStub = join(stubDir, 'send.mjs')
writeFileSync(sendStub, `export async function sendMessage(ctx) { (globalThis.__sent ??= []).push(ctx); return { sent: true, blocked: false, gate: { allowed: true } } }`)
const assetsStub = join(stubDir, 'assets.mjs')
writeFileSync(assetsStub, `export async function adHocTemplateId() { return 'tpl-adhoc' }`)
const testRecipients = await bundle('src/app/api/comms/test/recipients/route.ts', {
  aliases: { '@/lib/auth/api': authStub, '@/lib/comms/send': sendStub, '@/lib/comms/assets': assetsStub },
})
const testRecipient = await bundle('src/app/api/comms/test/recipients/[id]/route.ts', { aliases: { '@/lib/auth/api': authStub } })
const clientConsent = await bundle('src/app/api/client/consent/route.ts', {
  aliases: { '@/lib/auth/api': authStub, '@/lib/portal/scope': scopeStub, '@/lib/auth/session': sessionStub },
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
// Who may CLEAR earlier opt-outs: only the authenticated portal, for the signed-in member's own
// address (review F1/F2). The public booking opt-in still records a documented grant (so START can
// restore after a later STOP) but never clears an opt-out: anyone can type anyone's number there.
const reconsentClears = (cfg) => cfg.member
const reconsentGrants = (cfg) => cfg.member || cfg.ch === 'sms'

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
  const lastRc = reconsentClears(cfg) ? seq.lastIndexOf('RECONSENT') : -1
  const inEffect = (i) => i > lastRc || seq[i] === 'BOUNCE'
  for (let i = 0; i < seq.length; i++) if (appliesHere(seq[i], cfg.ch, cfg) && inEffect(i)) { latestBlocking = seq[i]; latestBlockingIdx = i }
  // A clearing re-consent counts where it happened; a public opt-in is a grant on record whenever it
  // happened (START from the handset after it restores — the handset owner's own re-opt-in).
  const grantBefore = (idx) =>
    cfg.consent ||
    (reconsentClears(cfg) && seq.slice(0, idx).includes('RECONSENT')) ||
    (!reconsentClears(cfg) && reconsentGrants(cfg) && seq.includes('RECONSENT'))
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
    // I6 — a public opt-in (no tie between the submitter and the handset) never clears an opt-out.
    if (e === 'RECONSENT' && !reconsentClears(cfg) && reconsentGrants(cfg)) {
      checks++
      for (const r of records.dnc) {
        const before = parentRecords.dnc.find((p) => p.id === r.id)
        if (before && before.lifted_at !== r.lifted_at) fail(cfg, next, `I6: a public opt-in lifted a DNC row (${r.reason})`)
      }
    }
    if (e === 'RECONSENT' && reconsentClears(cfg)) {
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
  if (reconsentClears(cfg)) {
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
  const cfg = { ch: 'sms', member: true, consent: true }
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

// Review F2: a portal grant by one household member never clears another member's opt-out.
console.log("\nA household member's portal grant leaves another member's STOP in force")
{
  const cfg = { ch: 'sms', member: true, consent: true }
  const db = memDb({ now: iso })
  installDb(db)
  seedConfig(db, cfg)
  db.seed('household_members', [{ id: 'm2', household_id: 'h1', full_name: 'Sam Example', phone: '+12145550199', email: 'sam@example.com' }])
  clock.t += 60_000; await apply('STOP', 'sms', cfg, 910001)
  assert.equal(await allowed('sms'), false)
  globalThis.__signedInEmail = 'sam@example.com'
  clock.t += 60_000
  const res = await clientConsent.POST(makeReq('/api/client/consent', { body: { channel: 'sms', status: 'granted' } }))
  globalThis.__signedInEmail = undefined
  assert.equal(res.status, 200)
  const stopRow = db.rows('dnc_entries').find((r) => (r.reason ?? '').startsWith('inbound STOP'))
  assert.ok(stopRow && !stopRow.lifted_at, "Pat's STOP row is not lifted by Sam's grant")
  assert.equal(await allowed('sms'), false, "Pat still receives no SMS")
  console.log("  ✓ Pat's STOP stands after Sam turns SMS on in the portal")
}

// Review F1/F6: a public booking opt-in after a member's STOP clears nothing, and START still works.
console.log('\nA public booking opt-in after a STOP: nothing cleared; START restores')
{
  const cfg = { ch: 'sms', member: true, consent: true }
  const db = memDb({ now: iso })
  installDb(db)
  seedConfig(db, cfg)
  clock.t += 60_000; await apply('STOP', 'sms', cfg, 920001)
  clock.t += 60_000
  const r = await booking.captureBookingSmsConsent({ contactId: 'c1', appointmentId: 'a-920002', phone: PHONE, capturedAt: iso() })
  assert.equal(r.recorded, true)
  assert.equal(await allowed('sms'), false, 'the booking tick did not clear the STOP')
  clock.t += 60_000; await apply('START', 'sms', cfg, 920003)
  assert.equal(await allowed('sms'), true, 'START from the handset restores sending')
  console.log('  ✓ blocked after the booking tick; START restores')
}

// Owner decision (round 4), copy only: turning texts back on in the portal after a STOP tells the
// client to text START (the carrier keeps blocking until START); after a START, or for a non-STOP
// opt-out, it does not. The consent outcome is unchanged either way.
console.log('\nPortal re-opt-in after a STOP asks the client to text START')
{
  const grant = async () => (await clientConsent.POST(makeReq('/api/client/consent', { body: { channel: 'sms', status: 'granted' } }))).json()
  const cfg = { ch: 'sms', member: true, consent: true }
  let db = memDb({ now: iso }); installDb(db); seedConfig(db, cfg)
  clock.t += 60_000; await apply('STOP', 'sms', cfg, 930001)
  clock.t += 60_000
  const afterStop = await grant()
  assert.equal(afterStop.ok, true)
  assert.ok(afterStop.textStart?.number, 'a STOP on file → the response carries the practice texting number')
  assert.equal(await allowed('sms'), true, 'the consent outcome is unchanged by the notice')
  clock.t += 60_000; await apply('STOP', 'sms', cfg, 930002)
  clock.t += 60_000; await apply('START', 'sms', cfg, 930003)
  clock.t += 60_000
  assert.equal((await grant()).textStart, undefined, 'a STOP answered by START → no notice')
  db = memDb({ now: iso }); installDb(db); seedConfig(db, cfg)
  clock.t += 60_000; await apply('WEB_PORTAL', 'sms', cfg, 930004)
  clock.t += 60_000
  assert.equal((await grant()).textStart, undefined, 'a non-STOP opt-out → no notice')
  console.log('  ✓ STOP → notice; STOP → START → none; portal opt-out → none')
}

// Follow-up R1: a portal GRANT applies only to the signed-in member. Another member's grant never makes
// this member sendable — not directly, and not through STOP → START restoring a grant they never gave.
console.log("\nA household member's portal grant never grants consent for another member")
for (const ch of ['sms', 'email']) {
  const cfg = { ch, member: true, consent: false }
  const db = memDb({ now: iso })
  installDb(db)
  seedConfig(db, cfg)
  db.seed('household_members', [{ id: 'm2', household_id: 'h1', full_name: 'Sam Example', phone: '+12145550199', email: 'sam@example.com' }])
  assert.equal(await allowed(ch), false, 'harness: Pat starts with no consent')
  globalThis.__signedInEmail = 'sam@example.com'
  clock.t += 60_000
  const res = await clientConsent.POST(makeReq('/api/client/consent', { body: { channel: ch, status: 'granted' } }))
  globalThis.__signedInEmail = undefined
  assert.equal(res.status, 200)
  assert.equal(await allowed(ch), false, `${ch}: Sam's grant made Pat sendable`)
  const patRow = db.rows('consents').find((r) => r.member_id === 'm1' && r.channel === ch)
  assert.ok(!patRow || patRow.status !== 'granted', `${ch}: Sam's grant wrote a granted consents row for Pat`)
  if (ch === 'sms') {
    clock.t += 60_000; await apply('STOP', 'sms', cfg, 940001)
    clock.t += 60_000; await apply('START', 'sms', cfg, 940002)
    assert.equal(await allowed('sms'), false, "Pat's STOP → START restored a grant Pat never gave")
  }
  console.log(`  ✓ ${ch}: Sam's grant leaves Pat unsendable${ch === 'sms' ? ', also after STOP → START' : ''}`)
}
{
  // A revoke stays household-wide.
  const cfg = { ch: 'sms', member: true, consent: true }
  const db = memDb({ now: iso })
  installDb(db)
  seedConfig(db, cfg)
  db.seed('household_members', [{ id: 'm2', household_id: 'h1', full_name: 'Sam Example', phone: '+12145550199', email: 'sam@example.com' }])
  globalThis.__signedInEmail = 'sam@example.com'
  clock.t += 60_000
  const res = await clientConsent.POST(makeReq('/api/client/consent', { body: { channel: 'sms', status: 'revoked' } }))
  globalThis.__signedInEmail = undefined
  assert.equal(res.status, 200)
  assert.equal(await allowed('sms'), false, "a portal revoke still applies household-wide")
  console.log('  ✓ a portal revoke still covers every member')
}
{
  // No unique signed-in member → no grant at all.
  const cfg = { ch: 'sms', member: true, consent: false }
  const db = memDb({ now: iso })
  installDb(db)
  seedConfig(db, cfg)
  globalThis.__signedInEmail = 'nobody@example.com'
  clock.t += 60_000
  const res = await clientConsent.POST(makeReq('/api/client/consent', { body: { channel: 'sms', status: 'granted' } }))
  globalThis.__signedInEmail = undefined
  assert.equal(res.status, 409, 'no unique signed-in member → refused, not a silent success')
  assert.equal(await allowed('sms'), false, 'no unique signed-in member → nothing granted')
  console.log('  ✓ no unique signed-in member → no grant')
}

// Follow-up R4: a test destination creates no consent until it is verified; a test-recipient grant
// counts only for TEST sends (never at the gate for other sends, never as START evidence); deleting
// the destination appends a revoke; a code survives only a few wrong guesses.
console.log('\nTest-recipient consent')
{
  const TEST_PHONE = '+12145550123'
  const ctxFor = (isTest) => ({ channel: 'sms', to: TEST_PHONE, body: 'x', actor: 'test', templateKind: 'stored', templateId: 't1', ...(isTest ? { isTest: true } : {}) })
  const gate = async (isTest) => (await policy.resolveDispatchPolicy(ctxFor(isTest), deps, GATE_NOW)).gate.allowed
  const db = memDb({ now: iso })
  installDb(db)
  globalThis.__sent = []
  clock.t += 60_000
  const add = await testRecipients.POST(makeReq('/api/comms/test/recipients', { body: { channel: 'sms', address: TEST_PHONE } }))
  assert.equal(add.status, 200)
  const id = (await add.json()).recipient_id
  const grantsBefore = db.rows('comm_contact_consents').filter((r) => r.action === 'granted')
  assert.equal(grantsBefore.length, 0, 'an unverified test destination wrote a consent grant')
  assert.equal(globalThis.__sent.length, 1, 'the verification code was sent')
  const code = String(globalThis.__sent[0].body).match(/\d{6}/)[0]
  const verify = (c) => testRecipient.PATCH(makeReq(`/api/comms/test/recipients/${id}`, { method: 'PATCH', body: { code: c } }), { params: Promise.resolve({ id }) })
  clock.t += 60_000
  assert.equal((await verify(code)).status, 200)
  assert.equal(db.rows('comm_contact_consents').filter((r) => r.action === 'granted').length, 1, 'verification records the self-consent')
  assert.equal(await gate(true), true, 'a verified test destination may receive TEST sends')
  assert.equal(await gate(false), false, 'a test-recipient grant counted as consent for a non-test send')
  // STOP → START from the device: the test grant is not START evidence.
  const tcfg = { ch: 'sms', member: false, consent: false }
  const conv = { id: 'conv-t', channel: 'sms', contact: TEST_PHONE }
  clock.t += 60_000; await inbound.processInbound({ channel: 'sms', from: TEST_PHONE, body: 'STOP', provider: 'twilio', providerId: 'SM-t1' })
  clock.t += 60_000; await inbound.processInbound({ channel: 'sms', from: TEST_PHONE, body: 'START', provider: 'twilio', providerId: 'SM-t2' })
  assert.equal(await gate(false), false, 'START restored consent from a test-recipient grant')
  void tcfg; void conv
  // Delete → revoke appended.
  clock.t += 60_000
  const del = await testRecipient.DELETE(makeReq(`/api/comms/test/recipients/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) })
  assert.equal(del.status, 200)
  const last = db.rows('comm_contact_consents').filter((r) => r.contact === TEST_PHONE).sort((a, b) => (a.captured_at < b.captured_at ? -1 : 1)).at(-1)
  assert.equal(last.action, 'revoked', 'deleting a test destination appends a revoke')
  assert.equal(await gate(true), false, 'a deleted test destination no longer receives test sends')
  console.log('  ✓ no grant before verification; grant counts only for test sends; not START evidence; delete revokes')
}
{
  const db = memDb({ now: iso })
  installDb(db)
  globalThis.__sent = []
  const add = await testRecipients.POST(makeReq('/api/comms/test/recipients', { body: { channel: 'email', address: 'op@example.com' } }))
  const id = (await add.json()).recipient_id
  const code = String(globalThis.__sent[0].body).match(/\d{6}/)[0]
  const wrong = code === '000000' ? '111111' : '000000'
  const verify = (c) => testRecipient.PATCH(makeReq(`/api/comms/test/recipients/${id}`, { method: 'PATCH', body: { code: c } }), { params: Promise.resolve({ id }) })
  for (let i = 0; i < 4; i++) assert.equal((await verify(wrong)).status, 422, `wrong guess ${i + 1}`)
  assert.equal((await verify(wrong)).status, 429, 'the fifth wrong guess burns the code')
  const after = await verify(code)
  assert.notEqual(after.status, 200, 'the right code still worked after the attempt cap')
  assert.equal(db.rows('comm_contact_consents').filter((r) => r.action === 'granted').length, 0)
  console.log('  ✓ five wrong guesses burn the code; the right code no longer verifies')
}
{
  // CodeRabbit review of R4: concurrent wrong guesses are each counted (compare-and-set on the
  // stored state), so racing requests cannot get more than the cap's worth of "incorrect" answers;
  // and a failed write of the guess count is an error, never a silent uncounted guess.
  const db = memDb({ now: iso })
  installDb(db)
  globalThis.__sent = []
  const add = await testRecipients.POST(makeReq('/api/comms/test/recipients', { body: { channel: 'email', address: 'race@example.com' } }))
  const id = (await add.json()).recipient_id
  const code = String(globalThis.__sent[0].body).match(/\d{6}/)[0]
  const wrong = code === '000000' ? '111111' : '000000'
  const verify = (c) => testRecipient.PATCH(makeReq(`/api/comms/test/recipients/${id}`, { method: 'PATCH', body: { code: c } }), { params: Promise.resolve({ id }) })
  const statuses = (await Promise.all(Array.from({ length: 10 }, () => verify(wrong)))).map((r) => r.status)
  for (let i = 0; i < 10; i++) statuses.push((await verify(wrong)).status)
  const answered = statuses.filter((st) => st === 422).length
  assert.ok(answered <= 4, `${answered} "incorrect" answers — the attempt cap was bypassed by concurrency (${statuses.join(',')})`)
  assert.ok(statuses.includes(429), 'the code was eventually burned')

  const db2 = memDb({ now: iso, failOn: (q) => q.table === 'comms_test_recipients' && q.method === 'update' })
  installDb(db2)
  globalThis.__sent = []
  const add2 = await testRecipients.POST(makeReq('/api/comms/test/recipients', { body: { channel: 'email', address: 'err@example.com' } }))
  const id2 = (await add2.json()).recipient_id
  const r = await testRecipient.PATCH(makeReq(`/api/comms/test/recipients/${id2}`, { method: 'PATCH', body: { code: wrong } }), { params: Promise.resolve({ id: id2 }) })
  assert.ok(r.status >= 500, `an unrecorded wrong guess answered ${r.status}`)
  console.log('  ✓ concurrent wrong guesses are each counted; an unrecorded guess is an error')
}
{
  // CodeRabbit review of R4: (a) a verification whose grant insert AND compensating revert both
  // failed must be repairable by a later PATCH, not stuck "already verified" with no grant;
  // (b) deleting an UNVERIFIED destination writes no revoke (it never had a grant, and an address in
  // another format could otherwise revoke a different operator's verified test number).
  let grantFails = 1
  const db = memDb({ now: iso, failOn: (q) =>
    (q.table === 'comm_contact_consents' && q.method === 'insert' && q.payload?.action === 'granted' && grantFails-- > 0) ||
    (q.table === 'comms_test_recipients' && q.method === 'update' && q.payload?.verified_at === null) })
  installDb(db)
  globalThis.__sent = []
  const add = await testRecipients.POST(makeReq('/api/comms/test/recipients', { body: { channel: 'email', address: 'stuck@example.com' } }))
  const id = (await add.json()).recipient_id
  const code = String(globalThis.__sent[0].body).match(/\d{6}/)[0]
  const verify = () => testRecipient.PATCH(makeReq(`/api/comms/test/recipients/${id}`, { method: 'PATCH', body: { code } }), { params: Promise.resolve({ id }) })
  assert.ok((await verify()).status >= 500, 'the failed grant is reported')
  const again = await verify()
  assert.equal(again.status, 200)
  const grants = db.rows('comm_contact_consents').filter((r) => r.contact === 'stuck@example.com' && r.action === 'granted')
  assert.equal(grants.length, 1, 'a later PATCH repaired the missing grant')

  installDb(db)
  globalThis.__sent = []
  const add2 = await testRecipients.POST(makeReq('/api/comms/test/recipients', { body: { channel: 'email', address: 'unverified@example.com' } }))
  const id2 = (await add2.json()).recipient_id
  const del = await testRecipient.DELETE(makeReq(`/api/comms/test/recipients/${id2}`, { method: 'DELETE' }), { params: Promise.resolve({ id: id2 }) })
  assert.equal(del.status, 200)
  assert.equal(db.rows('comm_contact_consents').filter((r) => r.contact === 'unverified@example.com').length, 0, 'an unverified destination wrote a revoke')
  console.log('  ✓ a stuck verification is repaired by the next PATCH; an unverified destination is deleted without a revoke')
}

// Follow-up R13: EVERY stop condition cancels pending automation, not just an inbound STOP — the
// unsubscribe link, one-click, web/portal and operator opt-outs, hard bounce, complaint and carrier
// 21610. District nurture (keyed by address, not member) is part of the fan-out.
console.log('\nEvery opt-out closes live automation in all five engines')
{
  const LIVE = {
    comm_campaign_enrollments: 'enrolled',
    life_campaign_enrollments: 'active',
    pipeline_winback_enrollments: 'active',
    xsell_life_campaign_enrollments: 'running',
    district_nurture_enrollments: 'active',
  }
  const seedLive = (db) => {
    for (const [t, status] of Object.entries(LIVE)) {
      db.seed(t, [t === 'district_nurture_enrollments'
        ? { id: `${t}-1`, contact_id: 'c1', email: EMAIL, phone: PHONE, status }
        : { id: `${t}-1`, member_id: 'm1', household_id: 'h1', status }])
    }
  }
  const stillLive = (db) => Object.entries(LIVE).filter(([t, status]) => db.rows(t).some((r) => r.status === status)).map(([t]) => t)
  const cases = [['STOP', 'sms'], ['UNSUB_LINK', 'email'], ['ONE_CLICK', 'email'], ['WEB_PORTAL', 'sms'], ['WEB_PORTAL', 'email'], ['OPERATOR', 'sms'], ['BOUNCE', 'email'], ['COMPLAINT', 'email']]
  for (const [e, ch] of cases) {
    for (const member of [true, false]) {
      if (e === 'OPERATOR' && !member) continue
      const cfg = { ch, member, consent: true }
      const db = memDb({ now: iso }); installDb(db); seedConfig(db, cfg); seedLive(db)
      clock.t += 60_000; await apply(e, ch, cfg, 950000)
      const live = stillLive(db).filter((t) => member || t === 'district_nurture_enrollments')
      assert.deepEqual(live, [], `${e} (${ch}, ${member ? 'member' : 'contact'}) left live: ${live.join(', ')}`)
    }
  }
  {
    // Carrier 21610 (switch row absent → off): the stop fan-out is not behind the engine-state switch.
    const cfg = { ch: 'sms', member: true, consent: true }
    const db = memDb({ now: iso }); installDb(db); seedConfig(db, cfg); seedLive(db)
    clock.t += 60_000
    assert.deepEqual(await optOut.recordCarrierOptOut(PHONE, '21610'), { ok: true })
    assert.deepEqual(stillLive(db), [], `21610 left live: ${stillLive(db).join(', ')}`)
  }
  console.log('  ✓ STOP, unsubscribe link, one-click, web/portal, operator, bounce, complaint and 21610 each close every engine')
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
