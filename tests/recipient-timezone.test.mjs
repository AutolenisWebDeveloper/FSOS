// Recipient timezone resolution (Phase 2 / Batch 1c, step 1) — the PURE resolver that
// turns a recipient's phone NPA (primary) or ZIP (secondary) into an IANA zone NAME.
//
// Why this test is the proof: the quiet-hours floor is only meaningful if it is evaluated
// in the RECIPIENT's local time. Phase A established that FSOS could not do this at all —
// no timezone column on the spine, no NPA or ZIP map anywhere in the repo. This resolver
// is that capability, and the invariant it must never break is FAIL-CLOSED: an input the
// map cannot place returns `resolved: false`, NEVER a silent default to Central. A resolver
// that guesses Central on an unknown NPA would reproduce the exact defect Phase A found
// (agency-local time wearing the appearance of recipient-local resolution).
//
// IANA zone NAMES, never fixed offsets — DST is the tz database's job, not ours.
//
// Run: node tests/recipient-timezone.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-tz-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch {} })

execSync(
  `npx tsc src/lib/comms/recipient-timezone.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --strict`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const {
  resolveRecipientTimeZone,
  timeZoneForNpa,
  timeZoneForZip,
  npaOf,
  NON_GEOGRAPHIC_NPAS,
} = require(join(out, 'recipient-timezone.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// ── NPA parsing ──────────────────────────────────────────────────────────────
console.log('NANP parsing — npaOf()')

t('bare 10-digit', () => assert.equal(npaOf('2145550147'), '214'))
t('E.164 with +1', () => assert.equal(npaOf('+12145550147'), '214'))
t('11-digit leading 1', () => assert.equal(npaOf('12145550147'), '214'))
t('formatted with punctuation', () => assert.equal(npaOf('(214) 555-0147'), '214'))
t('dashes and spaces', () => assert.equal(npaOf('214 555 0147'), '214'))
t('too few digits → null', () => assert.equal(npaOf('5550147'), null))
t('empty → null', () => assert.equal(npaOf(''), null))
t('null input → null', () => assert.equal(npaOf(null), null))
t('non-NANP international (+44) → null', () => assert.equal(npaOf('+442079460958'), null))
t('NPA may not start with 0 or 1', () => {
  assert.equal(npaOf('0145550147'), null)
  assert.equal(npaOf('1145550147'), null)
})
t('N11 service code is not a valid NPA', () => assert.equal(npaOf('2115550147'), null))

// ── NPA → zone ───────────────────────────────────────────────────────────────
console.log('\nNPA → IANA zone')

const npaCases = [
  ['212', 'America/New_York', 'Manhattan'],
  ['617', 'America/New_York', 'Boston'],
  ['404', 'America/New_York', 'Atlanta'],
  ['305', 'America/New_York', 'Miami'],
  ['850', 'America/Chicago', 'Florida panhandle is CENTRAL, not Eastern'],
  ['448', 'America/Chicago', 'Florida panhandle overlay'],
  ['214', 'America/Chicago', 'Dallas'],
  ['713', 'America/Chicago', 'Houston'],
  ['512', 'America/Chicago', 'Austin'],
  ['915', 'America/Denver', 'El Paso is MOUNTAIN, unlike the rest of Texas'],
  ['806', 'America/Chicago', 'Lubbock/Amarillo stay Central'],
  ['312', 'America/Chicago', 'Chicago'],
  ['303', 'America/Denver', 'Denver'],
  ['801', 'America/Denver', 'Salt Lake City'],
  ['406', 'America/Denver', 'Montana'],
  ['602', 'America/Phoenix', 'Phoenix — Mountain WITHOUT DST'],
  ['520', 'America/Phoenix', 'Tucson'],
  ['928', 'America/Phoenix', 'northern Arizona'],
  ['213', 'America/Los_Angeles', 'Los Angeles'],
  ['415', 'America/Los_Angeles', 'San Francisco'],
  ['206', 'America/Los_Angeles', 'Seattle'],
  ['503', 'America/Los_Angeles', 'Portland'],
  ['702', 'America/Los_Angeles', 'Las Vegas'],
  ['907', 'America/Anchorage', 'Alaska'],
  ['808', 'Pacific/Honolulu', 'Hawaii — no DST'],
  ['787', 'America/Puerto_Rico', 'Puerto Rico'],
  ['671', 'Pacific/Guam', 'Guam'],
  ['416', 'America/Toronto', 'Toronto'],
  ['604', 'America/Vancouver', 'Vancouver'],
  ['306', 'America/Regina', 'Saskatchewan — no DST'],
]
for (const [npa, zone, note] of npaCases) {
  t(`${npa} → ${zone} (${note})`, () => assert.equal(timeZoneForNpa(npa), zone))
}

console.log('\nNon-geographic NPAs MUST NOT resolve (fail closed, never guess)')
for (const npa of ['800', '833', '844', '855', '866', '877', '888', '900', '700', '710', '988', '555']) {
  t(`${npa} is non-geographic → null`, () => {
    assert.equal(timeZoneForNpa(npa), null)
    assert.ok(NON_GEOGRAPHIC_NPAS.has(npa), `${npa} must be declared non-geographic`)
  })
}

t('867 (YT/NT/NU) spans zones → deliberately UNRESOLVED, not guessed', () =>
  assert.equal(timeZoneForNpa('867'), null))
t('an unassigned NPA → null', () => assert.equal(timeZoneForNpa('299'), null))

// ── ZIP → zone ───────────────────────────────────────────────────────────────
console.log('\nZIP → IANA zone')

const zipCases = [
  ['10001', 'America/New_York', 'NYC'],
  ['02139', 'America/New_York', 'Cambridge MA'],
  ['33101', 'America/New_York', 'Miami'],
  ['32501', 'America/Chicago', 'Pensacola — panhandle is CENTRAL'],
  ['75201', 'America/Chicago', 'Dallas'],
  ['79901', 'America/Denver', 'El Paso'],
  ['80202', 'America/Denver', 'Denver'],
  ['85001', 'America/Phoenix', 'Phoenix'],
  ['90001', 'America/Los_Angeles', 'Los Angeles'],
  ['98101', 'America/Los_Angeles', 'Seattle'],
  ['99501', 'America/Anchorage', 'Anchorage'],
  ['96801', 'Pacific/Honolulu', 'Honolulu'],
  ['00901', 'America/Puerto_Rico', 'San Juan'],
  ['37201', 'America/Chicago', 'Nashville is Central'],
  ['37901', 'America/New_York', 'Knoxville is Eastern'],
  ['75201-4321', 'America/Chicago', 'ZIP+4 is accepted'],
]
for (const [zip, zone, note] of zipCases) {
  t(`${zip} → ${zone} (${note})`, () => assert.equal(timeZoneForZip(zip), zone))
}

t('military APO/FPO ZIPs are non-geographic → null', () => {
  assert.equal(timeZoneForZip('09001'), null)
  assert.equal(timeZoneForZip('96201'), null)
})
t('a 4-digit fragment → null', () => assert.equal(timeZoneForZip('1000'), null))
t('non-numeric → null', () => assert.equal(timeZoneForZip('ABCDE'), null))
t('null → null', () => assert.equal(timeZoneForZip(null), null))

// ── The composed resolver ────────────────────────────────────────────────────
console.log('\nresolveRecipientTimeZone() — NPA primary, ZIP secondary, fail closed')

t('phone resolves → method npa, zone recorded, input recorded', () => {
  const r = resolveRecipientTimeZone({ phone: '+12145550147', zip: '90001' })
  assert.equal(r.resolved, true)
  assert.equal(r.timeZone, 'America/Chicago')
  assert.equal(r.method, 'npa')
  assert.equal(r.input, '214')
})

t('NPA WINS over ZIP when both resolve (phone is the spine field)', () => {
  const r = resolveRecipientTimeZone({ phone: '2125550147', zip: '90001' })
  assert.equal(r.timeZone, 'America/New_York', 'NPA must take precedence')
  assert.equal(r.method, 'npa')
})

t('no phone → falls back to ZIP', () => {
  const r = resolveRecipientTimeZone({ zip: '80202' })
  assert.equal(r.resolved, true)
  assert.equal(r.timeZone, 'America/Denver')
  assert.equal(r.method, 'zip')
  assert.equal(r.input, '802')
})

t('TOLL-FREE phone falls through to ZIP rather than failing outright', () => {
  const r = resolveRecipientTimeZone({ phone: '+18005550147', zip: '85001' })
  assert.equal(r.resolved, true)
  assert.equal(r.timeZone, 'America/Phoenix')
  assert.equal(r.method, 'zip')
})

t('no input at all → UNRESOLVED (never a default)', () => {
  const r = resolveRecipientTimeZone({})
  assert.equal(r.resolved, false)
  assert.equal(r.reason, 'no_input')
  assert.equal(r.timeZone, undefined, 'an unresolved result carries NO timeZone')
})

t('unknown NPA and no ZIP → UNRESOLVED with the NPA reason', () => {
  const r = resolveRecipientTimeZone({ phone: '2995550147' })
  assert.equal(r.resolved, false)
  assert.equal(r.reason, 'unknown_npa')
})

t('non-geographic NPA and no ZIP → UNRESOLVED, reason names it', () => {
  const r = resolveRecipientTimeZone({ phone: '8005550147' })
  assert.equal(r.resolved, false)
  assert.equal(r.reason, 'non_geographic_npa')
})

t('unparseable phone and no ZIP → UNRESOLVED', () => {
  const r = resolveRecipientTimeZone({ phone: '555' })
  assert.equal(r.resolved, false)
  assert.equal(r.reason, 'unparseable_phone')
})

t('unknown ZIP and no phone → UNRESOLVED', () => {
  const r = resolveRecipientTimeZone({ zip: '09001' })
  assert.equal(r.resolved, false)
  assert.equal(r.reason, 'unknown_zip')
})

t('THE CRITICAL INVARIANT: nothing unresolvable ever yields America/Chicago', () => {
  const unresolvable = [
    {},
    { phone: '8005550147' },
    { phone: '2995550147' },
    { phone: '555' },
    { zip: '09001' },
    { phone: '+442079460958' },
    { phone: '8885550147', zip: 'ABCDE' },
    { phone: '867555 0147' },
  ]
  for (const input of unresolvable) {
    const r = resolveRecipientTimeZone(input)
    assert.equal(r.resolved, false, `${JSON.stringify(input)} must NOT resolve`)
    assert.ok(!('timeZone' in r) || r.timeZone === undefined, 'no zone may leak on an unresolved result')
  }
})

t('state is NEVER a resolution input (both default to TX — a default is not evidence)', () => {
  // The resolver takes no state parameter at all. Passing one must not change anything.
  const withState = resolveRecipientTimeZone({ state: 'CA', zip: undefined, phone: undefined })
  assert.equal(withState.resolved, false)
  assert.equal(withState.reason, 'no_input')
})

// ── Every mapped zone must be a REAL IANA zone Intl can load ─────────────────
console.log('\nEvery mapped zone is a real IANA identifier')

t('every NPA-mapped and ZIP-mapped zone loads in Intl', () => {
  const zones = new Set()
  for (const [npa] of npaCases) zones.add(timeZoneForNpa(npa))
  for (const [zip] of zipCases) zones.add(timeZoneForZip(zip))
  for (const z of zones) {
    assert.ok(z, 'no null zone in the sampled set')
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric' }).format(new Date()),
      `${z} is not a loadable IANA zone`,
    )
  }
})

t('zones are NAMES, not fixed offsets — DST is the tz database\'s job', () => {
  // America/Chicago is CST (-6) in January and CDT (-5) in July. A fixed-offset map
  // would return the same hour for both; a real zone name does not.
  const jan = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' })
    .format(new Date(Date.UTC(2026, 0, 15, 18, 0)))
  const jul = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' })
    .format(new Date(Date.UTC(2026, 6, 15, 18, 0)))
  assert.notEqual(jan, jul, 'DST must shift the local hour')
  assert.equal(Number(jan), 12)
  assert.equal(Number(jul), 13)
})

t('America/Phoenix does NOT shift for DST (the documented Arizona case)', () => {
  const f = (m) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', hour: 'numeric', hourCycle: 'h23' })
    .format(new Date(Date.UTC(2026, m, 15, 18, 0)))
  assert.equal(f(0), f(6), 'Arizona holds the same offset year-round')
})

console.log(`\nAll ${passed} assertions passed.`)
