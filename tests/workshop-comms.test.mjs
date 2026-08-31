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
ok('offset→kind map is exact (D-1(b): 3d added; 60 retained as capability only)',
  R.reminderKindForOffset(10080) === 'reminder_7d' && R.reminderKindForOffset(4320) === 'reminder_3d' &&
  R.reminderKindForOffset(1440) === 'reminder_1d' && R.reminderKindForOffset(60) === 'reminder_1h' &&
  R.reminderKindForOffset(0) === 'reminder_starting' && R.reminderKindForOffset(999) === null)
ok('unmappedOffsets surfaces exactly the stray values (never silently dropped)',
  JSON.stringify(R.unmappedOffsets([10080, 999, 4320, 120])) === JSON.stringify([999, 120]))
const now = 1_800_000_000_000
ok('7d reminder DUE when registered before its fire-time and now in [fireAt,start]',
  R.isReminderDue({ offsetMinutes: 10080, startMs: now + 3 * D, nowMs: now, registeredMs: now - 5 * D }) === true)
ok('7d reminder SKIPPED when booked <7d out (registered after fire-time — spec §2.3)',
  R.isReminderDue({ offsetMinutes: 10080, startMs: now + 3 * D, nowMs: now, registeredMs: now - 1 * H }) === false)
ok('1h reminder DUE inside its window', R.isReminderDue({ offsetMinutes: 60, startMs: now + 30 * MIN, nowMs: now, registeredMs: now - 2 * D }) === true)
ok('1h reminder NOT due too early', R.isReminderDue({ offsetMinutes: 60, startMs: now + 3 * H, nowMs: now, registeredMs: now - 2 * D }) === false)
ok('before-start reminder NOT due after the event started', R.isReminderDue({ offsetMinutes: 60, startMs: now - 10 * MIN, nowMs: now, registeredMs: now - 2 * D }) === false)
// D-8: the engine 'confirmation' kind is DELETED — the register route's instant ack is
// the single confirmation of record. dueReminderKinds can no longer produce it.
ok('the engine cannot produce a confirmation (D-8: isConfirmationDue is gone; dueReminderKinds never yields it)',
  R.isConfirmationDue === undefined &&
  !R.dueReminderKinds({ startMs: now + 30 * MIN, nowMs: now, registeredMs: now - 10 * D, offsetsMinutes: [10080, 4320, 1440, 60, 0], venueZone: 'America/Chicago', deliveryMode: 'virtual' }).includes('confirmation'))
const kinds = R.dueReminderKinds({ startMs: now + 30 * MIN, nowMs: now, registeredMs: now - 10 * D, offsetsMinutes: [10080, 1440, 60], venueZone: 'America/Chicago', deliveryMode: 'in_person' })
ok('dueReminderKinds includes the due 1h reminder (capability offset)', kinds.includes('reminder_1h'))

console.log('\nDay-of-AM (WALL-CLOCK kind) + WS-071 mode gate + T+2/3d follow-up')
// 2026-08-07 session at 19:00Z = 2:00 PM CDT; 9:00 AM CDT that day = 14:00Z.
const START = Date.UTC(2026, 7, 7, 19, 0)
ok('dayOfNineAmMs resolves 9:00 AM on the VENUE calendar date (CDT: 14:00Z)',
  R.dayOfNineAmMs(START, 'America/Chicago') === Date.UTC(2026, 7, 7, 14, 0))
// January (CST): 9:00 AM = 15:00Z — the DST pair pins a real zone computation.
ok('…and is DST-correct (CST January: 15:00Z)',
  R.dayOfNineAmMs(Date.UTC(2026, 0, 20, 19, 0), 'America/Chicago') === Date.UTC(2026, 0, 20, 15, 0))
ok('day-of due inside [9AM venue, start]; not before; never after start; skipped for same-morning registrants',
  R.isDayOfDue({ startMs: START, nowMs: Date.UTC(2026, 7, 7, 15, 0), registeredMs: START - 3 * D, venueZone: 'America/Chicago' }) === true &&
  R.isDayOfDue({ startMs: START, nowMs: Date.UTC(2026, 7, 7, 13, 0), registeredMs: START - 3 * D, venueZone: 'America/Chicago' }) === false &&
  R.isDayOfDue({ startMs: START, nowMs: Date.UTC(2026, 7, 7, 20, 0), registeredMs: START - 3 * D, venueZone: 'America/Chicago' }) === false &&
  R.isDayOfDue({ startMs: START, nowMs: Date.UTC(2026, 7, 7, 15, 0), registeredMs: Date.UTC(2026, 7, 7, 14, 30), venueZone: 'America/Chicago' }) === false)
ok('a session STARTING before 9 AM venue-local never gets a day-of touch (empty window)',
  R.isDayOfDue({ startMs: Date.UTC(2026, 7, 7, 12, 0), nowMs: Date.UTC(2026, 7, 7, 12, 0), registeredMs: 0, venueZone: 'America/Chicago' }) === false)
const dueVirtual = R.dueReminderKinds({ startMs: now + 10 * MIN, nowMs: now, registeredMs: now - 10 * D, offsetsMinutes: [0], venueZone: 'America/Chicago', deliveryMode: 'virtual' })
const dueHybrid = R.dueReminderKinds({ startMs: now + 10 * MIN, nowMs: now + 11 * MIN, registeredMs: now - 10 * D, offsetsMinutes: [0], venueZone: 'America/Chicago', deliveryMode: 'hybrid' })
const dueInPerson = R.dueReminderKinds({ startMs: now + 10 * MIN, nowMs: now + 11 * MIN, registeredMs: now - 10 * D, offsetsMinutes: [0], venueZone: 'America/Chicago', deliveryMode: 'in_person' })
ok('reminder_starting fires for VIRTUAL and HYBRID only (WS-071 — walk-ins have no link to tap)',
  !dueVirtual.includes('reminder_starting') /* pre-start */ && dueHybrid.includes('reminder_starting') && !dueInPerson.includes('reminder_starting'))
ok('the follow-up trigger is a distinct delay (due at anchor+delay, not before)',
  R.isFollowupDue({ anchorMs: now, nowMs: now + 2 * D, followupDelayMinutes: 2880 }) === true &&
  R.isFollowupDue({ anchorMs: now, nowMs: now + D, followupDelayMinutes: 2880 }) === false)

console.log('\nPlaintext part (WS-067)')
const PLAIN = R.toPlainText('<h1>Hi {{name}}</h1><p>Your seat is saved.</p><hr /><p style="x">Visit <a href="https://x.test/w">the page</a> &amp; reply STOP to opt out.</p>')
ok('toPlainText strips tags, keeps link targets, decodes entities',
  PLAIN.includes('Hi {{name}}') && PLAIN.includes('Your seat is saved.') &&
  PLAIN.includes('the page (https://x.test/w)') && PLAIN.includes('& reply STOP') && !/[<>]/.test(PLAIN.replace(/&lt;|&gt;/g, '')))

console.log('\nReminder-class allowlist (SETTLED consent model — the closed enum)')
// Batch 4 widened the class by exactly the four LIFECYCLE service kinds (a change/
// cancellation notice + the cancel ack service the registration itself). Still closed.
ok('the allowlist is EXACTLY the reminder + lifecycle-service kinds (closed set)',
  JSON.stringify([...R.REMINDER_CLASS].sort()) === JSON.stringify([
    'cancel_ack', 'change_reschedule', 'change_venue', 'confirmation', 'event_cancelled',
    'reminder_1d', 'reminder_1h', 'reminder_3d', 'reminder_7d', 'reminder_day_of', 'reminder_starting',
  ]))
ok('every nurture/marketing kind is OUTSIDE the reminder class (cannot borrow the registration basis)',
  ['nurture_attended', 'nurture_left_early', 'nurture_no_show', 'nurture_registered_no_show', 'nurture_followup'].every((k) => R.isReminderClass(k) === false))
ok('an unknown kind is outside the class too (no default-open)', R.isReminderClass('anything_else') === false)

console.log('\nClaim generation (WS-029 re-arm key) + change-kind pick')
ok('re-armable kinds claim at the session generation (floored to 1)',
  R.claimGeneration('reminder_1d', 3) === 3 && R.claimGeneration('change_reschedule', 2) === 2 &&
  R.claimGeneration('reminder_7d', null) === 1 && R.claimGeneration('event_cancelled', 0) === 1)
ok('one-time kinds pin to generation 0 REGARDLESS of the session generation (a reschedule can never replay them)',
  R.claimGeneration('confirmation', 5) === 0 && R.claimGeneration('cancel_ack', 5) === 0 &&
  R.claimGeneration('nurture_attended', 5) === 0 && R.claimGeneration('nurture_followup', 5) === 0)
ok('the re-armable set is EXACTLY the pre-event reminders + change notices (closed set)',
  JSON.stringify([...R.REARMABLE_KINDS].sort()) === JSON.stringify([
    'change_reschedule', 'change_venue', 'event_cancelled',
    'reminder_1d', 'reminder_1h', 'reminder_3d', 'reminder_7d', 'reminder_day_of', 'reminder_starting',
  ]))
ok('a time move dominates a combined edit (ONE reschedule notice, never two)',
  R.pickChangeKind({ timeChanged: true, venueChanged: true }) === 'change_reschedule' &&
  R.pickChangeKind({ timeChanged: false, venueChanged: true }) === 'change_venue' &&
  R.pickChangeKind({ timeChanged: false, venueChanged: false }) === null)

console.log('\nQuiet-hours floor (recipient-local 9–20)')
ok('8am blocked, 9am ok, 7:59pm ok, 8pm blocked', R.withinQuietHours(8) === false && R.withinQuietHours(9) === true && R.withinQuietHours(19) === true && R.withinQuietHours(20) === false)
// The two offset-based cases that stood here are gone with recipientLocalHour. They routed
// withinQuietHours through a whole-hour UTC offset computed in this module; the engine now
// resolves the recipient-local hour from an IANA zone (dispatch-policy.localPartsInZone),
// and that path is covered by executing the engine in workshop-engine-invocation.test.mjs.
// The boundary assertion above already pins every edge of withinQuietHours itself.

console.log('\nTimezone offset (utcOffsetHoursForTimezone) — §11a repair: pinned per fixture date')
// July 20 is unambiguously CDT: the ONLY correct answer is −5. (The old assertion accepted
// −5 OR −6 — true for every legal state including the total-failure fallback — §11a A.)
ok('America/Chicago on July 20 is exactly CDT (−5)', R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 6, 20, 18, 0)) === -5)
ok('America/Chicago on January 20 is exactly CST (−6)', R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 0, 20, 18, 0)) === -6)
// DST boundary pair (2026: spring-forward Mar 8, fall-back Nov 1): the offset CHANGES
// across each boundary — a wrong-offset or no-DST implementation fails one side.
ok('spring-forward 2026: −6 the day before, −5 the day after', R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 2, 7, 18, 0)) === -6 && R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 2, 9, 18, 0)) === -5)
ok('fall-back 2026: −5 the day before, −6 the day after', R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 9, 31, 18, 0)) === -5 && R.utcOffsetHoursForTimezone('America/Chicago', Date.UTC(2026, 10, 2, 18, 0)) === -6)
// CONTRACT CHANGE (was: "unknown zone falls back to Central floor (−6)"). That fallback is
// gone. −6 is a guess wearing the word "conservative": it is only conservative for a venue
// that happens to be Central, and it moved the computed day-of fire time by up to six hours
// anywhere else — silently. The function now fails closed and its caller declines to fire.
ok('an UNKNOWN zone resolves to null — no Central floor, no guess',
  R.utcOffsetHoursForTimezone('Not/AZone', now) === null)
ok('an EMPTY zone resolves to null (the timezone column is NOT NULL, so \'\' is the real shape of unset)',
  R.utcOffsetHoursForTimezone('', now) === null && R.utcOffsetHoursForTimezone('   ', now) === null)
ok('an ABSENT zone resolves to null',
  R.utcOffsetHoursForTimezone(null, now) === null && R.utcOffsetHoursForTimezone(undefined, now) === null)

console.log('\nUnresolvable venue zone FAILS CLOSED (no guessed fire time)')
ok('usableZone accepts a real IANA zone and rejects every non-zone',
  R.usableZone('America/Chicago') === 'America/Chicago' &&
  R.usableZone(' America/Denver ') === 'America/Denver' &&
  R.usableZone('Not/AZone') === null && R.usableZone('') === null &&
  R.usableZone('   ') === null && R.usableZone(null) === null && R.usableZone(undefined) === null)
ok('dayOfNineAmMs returns null for an unusable zone instead of a Central-derived instant',
  R.dayOfNineAmMs(START, 'Not/AZone') === null &&
  R.dayOfNineAmMs(START, '') === null &&
  R.dayOfNineAmMs(START, null) === null)
// The falsifiability pin: 16:00Z on the session's UTC date, registered days earlier. Under
// the OLD code the en-CA lookup threw → UTC date parts, the offset defaulted to −6 → a fire
// time of 15:00Z → nowMs 16:00Z is inside [fire, start] → DUE. Restoring the fallback turns
// this assertion red, so it cannot pass by accident.
ok('isDayOfDue is FALSE for an unusable zone at an instant the −6 fallback would have called due',
  R.isDayOfDue({ startMs: START, nowMs: Date.UTC(2026, 7, 7, 16, 0), registeredMs: START - 3 * D, venueZone: 'Not/AZone' }) === false)
ok('…and the same instant IS due with the zone resolvable — the fixture drives the real window',
  R.isDayOfDue({ startMs: START, nowMs: Date.UTC(2026, 7, 7, 16, 0), registeredMs: START - 3 * D, venueZone: 'America/Chicago' }) === true)
ok('dueReminderKinds therefore omits reminder_day_of for an unusable zone, and keeps the offset kinds',
  !R.dueReminderKinds({ startMs: START, nowMs: Date.UTC(2026, 7, 7, 16, 0), registeredMs: START - 3 * D, offsetsMinutes: [1440], venueZone: 'Not/AZone', deliveryMode: 'in_person' }).includes('reminder_day_of') &&
  R.dueReminderKinds({ startMs: START, nowMs: Date.UTC(2026, 7, 7, 16, 0), registeredMs: START - 3 * D, offsetsMinutes: [1440], venueZone: 'America/Chicago', deliveryMode: 'in_person' }).includes('reminder_day_of'))

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
// MERGE NOTE: main updated its versions of these assertions only for the rename. The
// branch's are kept because they are the §11a repair — each regex anchors on an EXECUTABLE
// statement, so a comment or an import cannot satisfy it — and because main's consent
// assertion (`const consent = await durableConsentGranted` reading workshop_consent_events)
// asserts the PRE-D-3 model this branch replaced: consent is now read from the registration
// row. Main's line would fail against this engine. Nothing here was loosened to merge.
ok('the ONE dispatch is the awaited chokepoint call (main renamed sendThroughGate → sendMessage) (anchor: the executable await)', /const outcome = await sendMessage\(\{/.test(eng))
ok('no raw sender import can reach the engine', !/from '@\/lib\/messaging'/.test(eng) && !/\bsendSms\b/.test(eng) && !/\bsendEmail\b/.test(eng))
ok('consent is READ FROM THE ROW at the send site (SETTLED model anchor: the executable ternary + guard)', /const consent = isReminderClass\(kind\) \? true : reg\.marketing_opt_in === true/.test(eng) && /if \(!consent\)/.test(eng))
ok('the purpose class is declared per kind (executable ternary)', /purpose: isReminderClass\(kind\) \? 'TRANSACTIONAL' : 'WORKSHOP'/.test(eng))
ok('is_security exclusion is the executable selection guard (anchor: the full statement)', /if \(!workshop \|\| workshop\.status !== 'published' \|\| workshop\.is_security === true\) continue/.test(eng))
ok('securities registrants route to FFS via the executable call (anchor)', /await routeSecuritiesToFfs\(db, reg, workshop\)/.test(eng))
ok('sendable-template query requires approved+active+gate-handle (executable .eq chain)', /\.eq\('status', 'approved'\)/.test(eng) && /\.eq\('active', true\)/.test(eng) && /\.not\('comm_template_id', 'is', null\)/.test(eng))
ok('atomic claim before dispatch (executable insert + guarded retry update)', /status: 'sending'/.test(eng) && /\.eq\('status', 'deferred'\)/.test(eng))

// The additive-OR consent rule moved with enforcement: it now lives at the dispatch
// chokepoint's policy resolver, where it applies to EVERY send rather than only to callers
// that went through the old wrapper. The invariant is unchanged — a durable domain grant
// (the workshop registrant's own consent store) can only ADD consent, never remove it.
const policy = readFileSync(join(root, 'src/lib/comms/dispatch-policy.ts'), 'utf8')
ok(
  'dispatch-policy consent is additive OR (member consent OR public-intake grant OR durable grant OR waiver — never reduces)',
  /memberConsentOk \|\| contactConsentOk \|\| ctx\.durableConsentGranted === true \|\| waiverApplies/.test(policy),
)

console.log(`\n${passed} checks passed.`)
