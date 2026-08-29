// Workshop/Seminar lead-engine P2 proof (reminders + segmented post-event nurture).
// DB-free, three parts (mirrors tests/workshops-gate.test.mjs):
//   1. Pure decision logic (src/lib/workshops/reminders.ts) compiled standalone with tsc:
//      due-reminder scheduling, quiet-hours, idempotency/claim, segmentation, score deltas,
//      CAN-SPAM footer, timezone offset.
//   2. Static migration guarantees (040): RLS on every new table, no anon grant, the
//      idempotency unique key, placeholder-only template seeds, assumption-badged config.
//   3. Static engine guarantees (comms-engine.ts + send.ts): sends ONLY through the gate,
//      is_security exclusion → FFS, durable per-channel consent guard, placeholder templates
//      cannot activate.
// Run: node tests/workshop-comms.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-wcomms-'))
process.on('exit', () => {
  try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ }
})

let passed = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  console.log(`  ✓ ${name}`)
  passed++
}

const MIN = 60_000
const H = 60 * MIN
const D = 24 * H

// ── Part 1: pure logic ──
execSync(
  `npx tsc src/lib/workshops/reminders.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
  { cwd: root, stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const R = require(join(out, 'reminders.js'))

console.log('\nReminder scheduling (isReminderDue / dueReminderKinds)')
ok('offset→kind map is exact', R.reminderKindForOffset(10080) === 'reminder_7d' && R.reminderKindForOffset(1440) === 'reminder_1d' && R.reminderKindForOffset(60) === 'reminder_1h' && R.reminderKindForOffset(0) === 'reminder_starting' && R.reminderKindForOffset(999) === null)
const now = 1_800_000_000_000
ok('7d reminder DUE when registered before its fire-time and now in [fireAt,start]',
  R.isReminderDue({ offsetMinutes: 10080, startMs: now + 3 * D, nowMs: now, registeredMs: now - 5 * D }) === true)
ok('7d reminder SKIPPED when booked <7d out (registered after fire-time — spec §2.3)',
  R.isReminderDue({ offsetMinutes: 10080, startMs: now + 3 * D, nowMs: now, registeredMs: now - 1 * H }) === false)
ok('1h reminder DUE inside its window', R.isReminderDue({ offsetMinutes: 60, startMs: now + 30 * MIN, nowMs: now, registeredMs: now - 2 * D }) === true)
ok('1h reminder NOT due too early', R.isReminderDue({ offsetMinutes: 60, startMs: now + 3 * H, nowMs: now, registeredMs: now - 2 * D }) === false)
ok('before-start reminder NOT due after the event started', R.isReminderDue({ offsetMinutes: 60, startMs: now - 10 * MIN, nowMs: now, registeredMs: now - 2 * D }) === false)
ok('confirmation due while the event is still upcoming', R.isConfirmationDue({ startMs: now + D, nowMs: now }) === true && R.isConfirmationDue({ startMs: now - D, nowMs: now }) === false)
const kinds = R.dueReminderKinds({ startMs: now + 30 * MIN, nowMs: now, registeredMs: now - 10 * D, offsetsMinutes: [10080, 1440, 60], confirmationEnabled: true })
ok('dueReminderKinds includes confirmation first + the due 1h reminder', kinds[0] === 'confirmation' && kinds.includes('reminder_1h'))

console.log('\nReminder-class allowlist (SETTLED consent model — the closed enum)')
ok('the allowlist is EXACTLY the reminder kinds (closed set)',
  JSON.stringify([...R.REMINDER_CLASS].sort()) === JSON.stringify(['confirmation', 'reminder_1d', 'reminder_1h', 'reminder_3d', 'reminder_7d', 'reminder_day_of', 'reminder_starting']))
ok('every nurture/marketing kind is OUTSIDE the reminder class (cannot borrow the registration basis)',
  ['nurture_attended', 'nurture_left_early', 'nurture_no_show', 'nurture_registered_no_show'].every((k) => R.isReminderClass(k) === false))
ok('an unknown kind is outside the class too (no default-open)', R.isReminderClass('anything_else') === false)

console.log('\nQuiet-hours floor (recipient-local 9–20)')
ok('8am blocked, 9am ok, 7:59pm ok, 8pm blocked', R.withinQuietHours(8) === false && R.withinQuietHours(9) === true && R.withinQuietHours(19) === true && R.withinQuietHours(20) === false)
// recipientLocalHour: at 02:00 UTC with Central offset -6 → 20:00 previous day → 20 → blocked.
ok('a "starting now" send at 8:05pm local is outside quiet hours', R.withinQuietHours(R.recipientLocalHour(Date.UTC(2026, 6, 20, 2, 5), -6)) === false)
ok('same send at 3:00pm local is inside quiet hours', R.withinQuietHours(R.recipientLocalHour(Date.UTC(2026, 6, 20, 21, 0), -6)) === true)

console.log('\nTimezone offset (utcOffsetHoursForTimezone) — §11a repair: pinned per fixture date')
// July 20 is unambiguously CDT: the ONLY correct answer is −5. (The old assertion accepted
// −5 OR −6 — true for every legal state including the total-failure fallback — §11a A.)
ok('America/Chicago on July 20 is exactly CDT (−5)', R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 6, 20, 18, 0)) === -5)
ok('America/Chicago on January 20 is exactly CST (−6)', R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 0, 20, 18, 0)) === -6)
// DST boundary pair (2026: spring-forward Mar 8, fall-back Nov 1): the offset CHANGES
// across each boundary — a wrong-offset or no-DST implementation fails one side.
ok('spring-forward 2026: −6 the day before, −5 the day after', R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 2, 7, 18, 0)) === -6 && R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 2, 9, 18, 0)) === -5)
ok('fall-back 2026: −5 the day before, −6 the day after', R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 9, 31, 18, 0)) === -5 && R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 10, 2, 18, 0)) === -6)
ok('unknown zone falls back to Central floor (−6)', R.utcOffsetHoursForTimezone('Not/AZone', now) === -6)

console.log('\nIdempotency (decideClaim / classifySendOutcome)')
ok('no log → claim', R.decideClaim(null) === 'claim')
ok('deferred → retry (only retryable state)', R.decideClaim('deferred') === 'retry')
ok('sent/blocked/sending/skipped → skip (never resend)', ['sent', 'blocked', 'sending', 'skipped'].every((s) => R.decideClaim(s) === 'skip'))
ok('overlapping ticks resolve to one send: 2nd tick sees "sending" → skip', R.decideClaim('sending') === 'skip')
ok('retry of a sent row is a skip (retry === one send)', R.decideClaim('sent') === 'skip')
ok('outcome classes — sent / operational-hold deferrals / terminal blocks (WS-026 table)',
  R.classifySendOutcome(true, null) === 'sent' && R.classifySendOutcome(false, 'quiet_hours') === 'deferred' && R.classifySendOutcome(false, 'business_hours') === 'deferred' && R.classifySendOutcome(false, 'consent') === 'blocked' && R.classifySendOutcome(false, 'is_security') === 'blocked')
ok('WS-026: the A2P staging hold (sms_live) defers — it clears on approval, never burns the slot',
  R.classifySendOutcome(false, 'sms_live') === 'deferred')
ok('WS-026: frequency + collision holds defer (they roll over / end on their own)',
  R.classifySendOutcome(false, 'frequency') === 'deferred' && R.classifySendOutcome(false, 'collision') === 'deferred')
ok('WS-026: a provider failure (no gate block) retries bounded, then parks terminally',
  R.classifySendOutcome(false, null, 1) === 'deferred' && R.classifySendOutcome(false, null, R.PROVIDER_RETRY_MAX - 1) === 'deferred' && R.classifySendOutcome(false, null, R.PROVIDER_RETRY_MAX) === 'blocked')
ok('terminal steps stay terminal (dnc/suppression/template/personalization)',
  R.classifySendOutcome(false, 'dnc') === 'blocked' && R.classifySendOutcome(false, 'suppression') === 'blocked' && R.classifySendOutcome(false, 'approved_template') === 'blocked' && R.classifySendOutcome(false, 'personalization') === 'blocked')

console.log('\nSegmentation + lead-score deltas')
ok('attended→attended, left_early→left_early, no_show→no_show, null/registered→registered_no_show',
  R.segmentFor('attended') === 'attended' && R.segmentFor('left_early') === 'left_early' && R.segmentFor('no_show') === 'no_show' && R.segmentFor(null) === 'registered_no_show' && R.segmentFor('registered') === 'registered_no_show')
ok('segment→template kind', R.nurtureKindForSegment('attended') === 'nurture_attended' && R.nurtureKindForSegment('no_show') === 'nurture_no_show' && R.nurtureKindForSegment('registered_no_show') === 'nurture_registered_no_show')
ok('segment→GHL tag', R.segmentTag('attended') === 'wshop-attended' && R.segmentTag('left_early') === 'wshop-attended' && R.segmentTag('no_show') === 'wshop-noshow' && R.segmentTag('registered_no_show') === 'wshop-registered')
const scores = { score_attended: 15, score_engaged: 25, score_no_show: -5, score_registered_no_show: -2, score_replay_viewed: 10 }
ok('score deltas differ by segment (attended +, no_show −, registered −)',
  R.scoreDeltaForSegment('attended', scores) === 15 && R.scoreDeltaForSegment('left_early', scores) === 15 && R.scoreDeltaForSegment('no_show', scores) === -5 && R.scoreDeltaForSegment('registered_no_show', scores) === -2)
ok('nurture due only after end + delay', R.isNurtureDue({ anchorMs: now, nowMs: now + 200 * MIN, delayMinutes: 180 }) === true && R.isNurtureDue({ anchorMs: now, nowMs: now + 60 * MIN, delayMinutes: 180 }) === false)

console.log('\nCAN-SPAM footer (physical address + one-click unsubscribe)')
const footer = R.buildCanSpamFooter({ unsubscribeUrl: 'https://app.example/unsubscribe?c=a%40b.com&ch=email', physicalAddress: '123 Main St, McKinney TX' })
ok('footer carries a one-click unsubscribe link', footer.includes('/unsubscribe') && footer.includes('Unsubscribe'))
ok('footer carries the physical mailing address', footer.includes('123 Main St, McKinney TX'))
ok('appendCanSpamFooter is idempotent (does not double-append)', R.appendCanSpamFooter(R.appendCanSpamFooter('body', footer), footer).match(/\/unsubscribe/g).length === 1)

// ── Part 2: static migration guarantees (040) ──
console.log('\nMigration 040 (static guarantees)')
const mig = readFileSync(join(root, 'supabase/migrations/040_workshop_comms_engine.sql'), 'utf8')
for (const t of ['workshop_comms_config', 'workshop_message_templates', 'workshop_message_log']) {
  ok(`RLS enabled on ${t}`, new RegExp(`alter table ${t}\\s+enable row level security`).test(mig))
}
ok('no anon/public grant anywhere in 040', !/\bto\s+anon\b/i.test(mig) && !/\bto\s+public\b/i.test(mig) && !/using\s*\(\s*true\s*\)/i.test(mig))
ok('idempotency key: unique(registration_id, channel, kind) on the send-log', /unique\s*\(\s*registration_id\s*,\s*channel\s*,\s*kind\s*\)/.test(mig))
ok('template status defaults to placeholder + seeds are all placeholders', /status\s+text not null default 'placeholder'/.test(mig) && (mig.match(/\[PLACEHOLDER/g) || []).length >= 10)
ok('template seeds ship inactive (active default false) + assumption-badged', /active\s+boolean not null default false/.test(mig) && /is_assumption\s+boolean not null default true/.test(mig))
ok('config offsets + score deltas + physical address are assumption-badged config', /reminder_offsets_minutes\s+integer\[\]/.test(mig) && /score_attended/.test(mig) && /sender_physical_address/.test(mig) && /is_assumption\s+boolean not null default true/.test(mig))
ok('NO insert/update/delete policy on the new tables (service-role writes only)', !/for\s+(insert|update|delete)/i.test(mig))
ok('additive only — no destructive DDL', !/\bdrop\s+table\b/i.test(mig) && !/\bdrop\s+column\b/i.test(mig) && !/\btruncate\b/i.test(mig))

// ── Part 3: engine wiring — §11a repair. The old regexes here were satisfiable by the
// header comment and the import line alone (delete the gated dispatch, keep the comment,
// stay green — sweep §11a pattern B). The BEHAVIORAL guarantees now live in
// tests/workshop-engine-invocation.test.mjs (executed engine + recording gate stub) and
// the pinned workshop-guarantee-*.test.mjs suite (real Postgres). What remains here are
// EXECUTABLE-STATEMENT anchors: each regex matches only the executable call/guard, so a
// comment or import cannot satisfy it.
console.log('\nEngine wiring (executable-statement anchors; behavior proven in workshop-engine-invocation)')
const eng = readFileSync(join(root, 'src/lib/workshops/comms-engine.ts'), 'utf8')
ok('the ONE dispatch is the awaited gate call (anchor: the executable await)', /const outcome = await sendThroughGate\(\{/.test(eng))
ok('no raw sender import can reach the engine', !/from '@\/lib\/messaging'/.test(eng) && !/\bsendSms\b/.test(eng) && !/\bsendEmail\b/.test(eng))
ok('consent is READ FROM THE ROW at the send site (SETTLED model anchor: the executable ternary + guard)', /const consent = isReminderClass\(kind\) \? true : reg\.marketing_opt_in === true/.test(eng) && /if \(!consent\)/.test(eng))
ok('the purpose class is declared per kind (executable ternary)', /purpose: isReminderClass\(kind\) \? 'TRANSACTIONAL' : 'WORKSHOP'/.test(eng))
ok('is_security exclusion is the executable selection guard (anchor: the full statement)', /if \(!workshop \|\| workshop\.status !== 'published' \|\| workshop\.is_security === true\) continue/.test(eng))
ok('securities registrants route to FFS via the executable call (anchor)', /await routeSecuritiesToFfs\(db, reg, workshop\)/.test(eng))
ok('sendable-template query requires approved+active+gate-handle (executable .eq chain)', /\.eq\('status', 'approved'\)/.test(eng) && /\.eq\('active', true\)/.test(eng) && /\.not\('comm_template_id', 'is', null\)/.test(eng))
ok('atomic claim before dispatch (executable insert + guarded retry update)', /status: 'sending'/.test(eng) && /\.eq\('status', 'deferred'\)/.test(eng))

const send = readFileSync(join(root, 'src/lib/comms/send.ts'), 'utf8')
ok('send.ts consent is additive OR (member consent OR public-intake grant OR durable grant — never reduces)', /memberConsent \|\| contactConsent \|\| ctx\.durableConsentGranted === true/.test(send))

console.log(`\n${passed} checks passed.`)
