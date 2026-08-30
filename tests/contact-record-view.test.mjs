// Contact Record read model (src/lib/contacts/record-view.ts) — pure, DB-free.
// Proves the derivations the redesigned /app/contacts/[id] workspace renders from:
// DOB→age, monogram, phone/tel/sms/mailto targets, due buckets, next appointment,
// the snapshot totals, what counts as "needs attention", the timeline grouping, and
// the display-only channel state. Run: node tests/contact-record-view.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-contactview-'))
execSync(
  `npx tsc src/lib/contacts/record-view.ts --outDir ${out} --rootDir src/lib/contacts ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const V = require(join(out, 'record-view.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const DAY = 86_400_000
// "Now" = 2026-08-30T15:00:00Z.
const NOW = Date.parse('2026-08-30T15:00:00Z')
const at = (days, hour = 12) => new Date(NOW + days * DAY).toISOString().replace(/T\d\d/, `T${String(hour).padStart(2, '0')}`)

// ─── Sections ─────────────────────────────────────────────────────────────────

t('toContactSection accepts known ids and falls back to overview', () => {
  assert.equal(V.toContactSection('activity'), 'activity')
  assert.equal(V.toContactSection('profile'), 'profile')
  assert.equal(V.toContactSection('nope'), 'overview')
  assert.equal(V.toContactSection(undefined), 'overview')
  assert.equal(V.toContactSection(''), 'overview')
  // Never trust a query param into a lookup: an injected value must not pass.
  assert.equal(V.toContactSection('__proto__'), 'overview')
})

t('every declared section id is routable', () => {
  for (const s of V.CONTACT_RECORD_SECTIONS) assert.equal(V.toContactSection(s.id), s.id)
})

// ─── Identity ─────────────────────────────────────────────────────────────────

t('ageFromDob counts whole years and respects the birthday boundary', () => {
  assert.equal(V.ageFromDob('1972-03-14', NOW), 54) // birthday already passed in 2026
  assert.equal(V.ageFromDob('1972-12-31', NOW), 53) // birthday still ahead
  assert.equal(V.ageFromDob('1972-08-30', NOW), 54) // birthday is today
  assert.equal(V.ageFromDob('1972-08-31', NOW), 53) // tomorrow
})

t('ageFromDob refuses to invent an age', () => {
  assert.equal(V.ageFromDob(null, NOW), null)
  assert.equal(V.ageFromDob('', NOW), null)
  assert.equal(V.ageFromDob('not-a-date', NOW), null)
  assert.equal(V.ageFromDob('1972-13-01', NOW), null)
  assert.equal(V.ageFromDob('2099-01-01', NOW), null) // future DOB → no age, not a negative
  assert.equal(V.ageFromDob('1800-01-01', NOW), null) // implausible → no age
})

t('initialsOf handles hyphens, single names, punctuation, and blanks', () => {
  assert.equal(V.initialsOf('Margarethe Okonkwo-Villanueva'), 'MO')
  assert.equal(V.initialsOf('Dee'), 'D')
  assert.equal(V.initialsOf("  o'brien  "), 'O')
  assert.equal(V.initialsOf('María José Álvarez'), 'MÁ')
  assert.equal(V.initialsOf(''), '?')
  assert.equal(V.initialsOf(null), '?')
  assert.equal(V.initialsOf('***'), '?')
})

t('formatPhone normalizes 10- and 11-digit US numbers and passes anything else through', () => {
  assert.equal(V.formatPhone('9725550147'), '(972) 555-0147')
  assert.equal(V.formatPhone('+1 972 555 0147'), '(972) 555-0147')
  assert.equal(V.formatPhone('+44 20 7946 0958'), '+44 20 7946 0958')
  assert.equal(V.formatPhone(null), null)
  assert.equal(V.formatPhone('   '), null)
})

t('dial/mail targets are only produced when they can actually dial or send', () => {
  assert.equal(V.dialHref('tel', '(972) 555-0147'), 'tel:+19725550147')
  assert.equal(V.dialHref('sms', '19725550147'), 'sms:+19725550147')
  assert.equal(V.dialHref('tel', '123'), null) // too short to be a number
  assert.equal(V.dialHref('tel', null), null)
  assert.equal(V.mailHref('a@b.com'), 'mailto:a@b.com')
  assert.equal(V.mailHref('not-an-email'), null)
  assert.equal(V.mailHref(null), null)
})

// ─── Dates ────────────────────────────────────────────────────────────────────

t('dueBucket separates overdue, today, soon, later, and none', () => {
  assert.equal(V.dueBucket(at(-4), NOW), 'overdue')
  assert.equal(V.dueBucket(new Date(NOW).toISOString(), NOW), 'today')
  assert.equal(V.dueBucket(at(3), NOW), 'soon')
  assert.equal(V.dueBucket(at(30), NOW), 'later')
  assert.equal(V.dueBucket(null, NOW), 'none')
  assert.equal(V.dueBucket('garbage', NOW), 'none')
})

t('a due time earlier TODAY buckets as today, never as overdue', () => {
  const earlierToday = new Date(NOW - 3 * 3600_000).toISOString()
  assert.equal(V.dueBucket(earlierToday, NOW), 'today')
})

t('relativeDay reads the way a person says it', () => {
  assert.equal(V.relativeDay(new Date(NOW).toISOString(), NOW), 'today')
  assert.equal(V.relativeDay(at(1), NOW), 'tomorrow')
  assert.equal(V.relativeDay(at(-1), NOW), 'yesterday')
  assert.equal(V.relativeDay(at(4), NOW), 'in 4 days')
  assert.equal(V.relativeDay(at(-4), NOW), '4 days ago')
  assert.equal(V.relativeDay(null, NOW), '—')
})

// ─── Pipeline / appointments ──────────────────────────────────────────────────

t('isOpenOpportunity closes only on placed_issued and lost', () => {
  for (const s of ['prospect', 'fact_find', 'quoted_proposed', 'application', 'underwriting_suitability']) {
    assert.equal(V.isOpenOpportunity(s), true, s)
  }
  assert.equal(V.isOpenOpportunity('placed_issued'), false)
  assert.equal(V.isOpenOpportunity('lost'), false)
})

t('nextAppointment picks the soonest FUTURE scheduled slot only', () => {
  const rows = [
    { id: 'past', scheduled_at: at(-2), status: 'scheduled' },
    { id: 'far', scheduled_at: at(20), status: 'scheduled' },
    { id: 'soon', scheduled_at: at(3), status: 'scheduled' },
    { id: 'cancelled-sooner', scheduled_at: at(1), status: 'cancelled' },
    { id: 'noshow', scheduled_at: at(2), status: 'no_show' },
    { id: 'undated', scheduled_at: null, status: 'scheduled' },
  ]
  assert.equal(V.nextAppointment(rows, NOW).id, 'soon')
  assert.equal(V.nextAppointment([], NOW), null)
  assert.equal(V.nextAppointment([rows[0]], NOW), null) // only a past one → nothing next
})

t('appointmentStart prefers starts_at (native booking) over scheduled_at', () => {
  assert.equal(V.appointmentStart({ starts_at: at(5), scheduled_at: at(9), status: 'scheduled' }), Date.parse(at(5)))
  assert.equal(V.appointmentStart({ starts_at: null, scheduled_at: at(9), status: 'scheduled' }), Date.parse(at(9)))
  assert.equal(V.appointmentStart({ starts_at: null, scheduled_at: null, status: 'scheduled' }), null)
})

// ─── Snapshot ─────────────────────────────────────────────────────────────────

t('summarizeContact totals only ACTIVE coverage and OPEN pipeline', () => {
  const s = V.summarizeContact({
    policies: [
      { id: '1', status: 'active', is_security: false, face_amount: 750000, policy_number: null, product_name: null },
      { id: '2', status: 'active', is_security: false, face_amount: '250000', policy_number: null, product_name: null },
      { id: '3', status: 'lapsed', is_security: false, face_amount: 999999, policy_number: null, product_name: null },
    ],
    opportunities: [
      { id: 'a', stage: 'quoted_proposed', engagement: null, is_security: false, expected_commission: 4820, face_amount: null, updated_at: at(-4) },
      { id: 'b', stage: 'placed_issued', engagement: null, is_security: false, expected_commission: 2100, face_amount: null, updated_at: at(-150) },
    ],
    tasks: [
      { id: 't1', title: 'x', due_at: at(-4), completed: false, source: null, entity_type: 'contact' },
      { id: 't2', title: 'y', due_at: at(4), completed: false, source: null, entity_type: 'contact' },
      { id: 't3', title: 'z', due_at: at(-9), completed: true, source: null, entity_type: 'contact' },
    ],
    stream: [
      { id: 's1', kind: 'call', note: null, actor: null, created_at: at(-4) },
      { id: 's2', kind: 'email', note: null, actor: null, created_at: at(-9) },
    ],
    now: NOW,
  })
  assert.equal(s.coverageInForce, 1_000_000) // lapsed excluded, string coerced
  assert.equal(s.activePolicies, 2)
  assert.equal(s.openOpportunities, 1)
  assert.equal(s.openPipelineValue, 4820) // closed opportunity excluded
  assert.equal(s.openTasks, 2)
  assert.equal(s.overdueTasks, 1) // the completed overdue one does not count
  assert.equal(s.lastTouchAt, at(-4))
})

t('summarizeContact ignores future-dated stream rows when picking last touch', () => {
  const s = V.summarizeContact({
    policies: [],
    opportunities: [],
    tasks: [],
    stream: [
      { id: 'future', kind: 'note', note: null, actor: null, created_at: at(5) },
      { id: 'real', kind: 'call', note: null, actor: null, created_at: at(-2) },
    ],
    now: NOW,
  })
  assert.equal(s.lastTouchAt, at(-2))
})

t('num coerces safely and never yields NaN into a total', () => {
  assert.equal(V.num(5), 5)
  assert.equal(V.num('5.5'), 5.5)
  assert.equal(V.num('abc'), 0)
  assert.equal(V.num(null), 0)
  assert.equal(V.num(undefined), 0)
})

// ─── Attention ────────────────────────────────────────────────────────────────

const attn = (over = {}) =>
  V.deriveAttention({
    contactId: 'c1',
    archived: false,
    doNotContact: false,
    tasks: [],
    appointments: [],
    opportunities: [],
    openDocumentRequests: 0,
    hasContactChannel: true,
    now: NOW,
    ...over,
  })

t('a clean record raises nothing', () => {
  assert.deepEqual(attn(), [])
})

t('do-not-contact is the most urgent item and links to suppression', () => {
  const items = attn({ doNotContact: true })
  assert.equal(items[0].key, 'dnc')
  assert.equal(items[0].tone, 'critical')
  assert.equal(items[0].href, '/app/comms/suppression')
})

t('overdue tasks rank above due-today, and both name the count', () => {
  const items = attn({
    tasks: [
      { id: '1', title: 'Send the illustration', due_at: at(-4), completed: false, source: null, entity_type: 'contact' },
      { id: '2', title: 'Second overdue', due_at: at(-1), completed: false, source: null, entity_type: 'contact' },
      { id: '3', title: 'Today', due_at: new Date(NOW).toISOString(), completed: false, source: null, entity_type: 'contact' },
    ],
  })
  assert.equal(items[0].key, 'tasks-overdue')
  assert.match(items[0].label, /2 tasks overdue/)
  assert.equal(items[1].key, 'tasks-today')
})

t('a single overdue task is named, not counted', () => {
  const items = attn({
    tasks: [{ id: '1', title: 'Send the illustration', due_at: at(-4), completed: false, source: null, entity_type: 'contact' }],
  })
  assert.match(items[0].label, /Send the illustration/)
})

t('completed tasks never raise attention', () => {
  assert.deepEqual(
    attn({ tasks: [{ id: '1', title: 'done', due_at: at(-40), completed: true, source: null, entity_type: 'contact' }] }),
    [],
  )
})

t('a past appointment still marked scheduled is surfaced for an outcome', () => {
  const items = attn({ appointments: [{ id: 'a', scheduled_at: at(-3), status: 'scheduled' }] })
  assert.equal(items[0].key, 'appt-stale')
})

t('a no-show with nothing rebooked is surfaced; a rebooked one is not', () => {
  const missed = { id: 'a', scheduled_at: at(-10), status: 'no_show' }
  assert.equal(attn({ appointments: [missed] })[0].key, 'appt-noshow')
  const rebooked = attn({ appointments: [missed, { id: 'b', scheduled_at: at(4), status: 'scheduled' }] })
  assert.equal(rebooked.find((i) => i.key === 'appt-noshow'), undefined)
})

t('an open opportunity that has not moved in 30+ days is surfaced; a fresh one is not', () => {
  const stale = { id: 'o', stage: 'quoted_proposed', engagement: null, is_security: false, expected_commission: null, face_amount: null, updated_at: at(-45) }
  const fresh = { ...stale, id: 'o2', updated_at: at(-3) }
  const closedStale = { ...stale, id: 'o3', stage: 'lost' }
  assert.equal(attn({ opportunities: [stale] }).some((i) => i.key === 'opp-stalled'), true)
  assert.equal(attn({ opportunities: [fresh] }).some((i) => i.key === 'opp-stalled'), false)
  assert.equal(attn({ opportunities: [closedStale] }).some((i) => i.key === 'opp-stalled'), false)
})

t('an unreachable contact is called out, and an archived one is noted last', () => {
  const items = attn({ hasContactChannel: false, archived: true })
  assert.equal(items.some((i) => i.key === 'no-channel'), false, 'archived records do not nag about channels')
  assert.equal(items[items.length - 1].key, 'archived')
  assert.equal(attn({ hasContactChannel: false }).some((i) => i.key === 'no-channel'), true)
})

t('every attention item carries a real destination and a CTA', () => {
  const items = attn({
    doNotContact: true,
    tasks: [{ id: '1', title: 'x', due_at: at(-4), completed: false, source: null, entity_type: 'contact' }],
    appointments: [{ id: 'a', scheduled_at: at(-3), status: 'scheduled' }],
    openDocumentRequests: 2,
    opportunities: [{ id: 'o', stage: 'prospect', engagement: null, is_security: false, expected_commission: null, face_amount: null, updated_at: at(-45) }],
    hasContactChannel: false,
  })
  assert.ok(items.length >= 5)
  for (const i of items) {
    assert.ok(i.href && i.href.startsWith('/'), `bad href on ${i.key}`)
    assert.ok(i.cta && i.cta.length > 0, `missing cta on ${i.key}`)
    assert.ok(['critical', 'warning', 'info'].includes(i.tone))
  }
  assert.equal(new Set(items.map((i) => i.key)).size, items.length, 'keys must be unique for React')
})

// ─── Timeline ─────────────────────────────────────────────────────────────────

t('timelineGroup routes each kind to a filter a human would expect', () => {
  assert.equal(V.timelineGroup('call'), 'conversations')
  assert.equal(V.timelineGroup('sms'), 'conversations')
  assert.equal(V.timelineGroup('email'), 'conversations')
  assert.equal(V.timelineGroup('appointment_booked'), 'meetings')
  assert.equal(V.timelineGroup('review'), 'meetings')
  assert.equal(V.timelineGroup('note'), 'notes')
  assert.equal(V.timelineGroup('import'), 'system')
  assert.equal(V.timelineGroup('stage_change'), 'system')
  assert.equal(V.timelineGroup(null), 'system')
  assert.equal(V.timelineGroup('something_new'), 'system')
})

t('the All filter matches everything and a group filter matches only its group', () => {
  assert.equal(V.matchesTimelineFilter('import', 'all'), true)
  assert.equal(V.matchesTimelineFilter('call', 'conversations'), true)
  assert.equal(V.matchesTimelineFilter('call', 'notes'), false)
})

t('every kind with a display label lands in a real group', () => {
  for (const k of Object.keys(V.STREAM_KIND_LABEL)) {
    assert.ok(['conversations', 'meetings', 'notes', 'system'].includes(V.timelineGroup(k)), k)
  }
})

// ─── Reachability ─────────────────────────────────────────────────────────────

t('channelState is display-only and fails toward the restrictive answer', () => {
  assert.equal(V.channelState({ hasAddress: false, suppressed: false, consent: 'granted' }), 'missing')
  assert.equal(V.channelState({ hasAddress: true, suppressed: true, consent: 'granted' }), 'suppressed')
  assert.equal(V.channelState({ hasAddress: true, suppressed: false, consent: 'revoked' }), 'revoked')
  assert.equal(V.channelState({ hasAddress: true, suppressed: false, consent: 'granted' }), 'granted')
  assert.equal(V.channelState({ hasAddress: true, suppressed: false, consent: null }), 'unknown')
})

t('every channel state has a label the rail can render', () => {
  for (const s of ['granted', 'revoked', 'suppressed', 'unknown', 'missing']) {
    assert.ok(V.CHANNEL_STATE_LABEL[s], s)
  }
})

t('phoneTail matches +1-prefixed and bare numbers identically', () => {
  assert.equal(V.phoneTail('+1 (972) 555-0147'), '9725550147')
  assert.equal(V.phoneTail('9725550147'), '9725550147')
  assert.equal(V.phoneTail(null), '')
})

console.log(`\n${passed} assertion groups passed`)
