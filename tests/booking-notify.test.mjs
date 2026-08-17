// Native booking — pure notification-core proof (src/lib/booking/notify-core.ts).
// Compiles the DB-free module in isolation and asserts the reminder-due rule, the merge
// context, and the meeting-details copy that the confirmation/reminder sends depend on.
// Run: node tests/booking-notify.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-notify-'))
execSync(
  `npx tsc src/lib/booking/notify-core.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { formatAppointmentTime, meetingDetailsText, buildBookingContext, isReminderDue, DEFAULT_REMINDER_LEAD_HOURS, buildBookingFallbackContent } =
  require(join(out, 'notify-core.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}
const HOUR = 3_600_000

t('formatAppointmentTime renders the booker-zone wall time with a zone label', () => {
  const s = formatAppointmentTime('2026-08-03T14:00:00Z', 'America/Chicago') // 9:00 AM CDT
  assert.match(s, /Monday, August 3, 2026/)
  assert.match(s, /9:00\s?AM/)
  assert.match(s, /CDT/)
})
t('formatAppointmentTime falls back to UTC on an unknown zone instead of throwing', () => {
  const s = formatAppointmentTime('2026-08-03T14:00:00Z', 'Not/AZone')
  assert.match(s, /2:00\s?PM/) // 14:00 UTC
  assert.match(s, /UTC|GMT/)
})

t('meetingDetailsText: video with a link includes the URL', () => {
  assert.match(meetingDetailsText({ meetingMode: 'video', joinUrl: 'https://zoom.us/j/123' }), /https:\/\/zoom\.us\/j\/123/)
})
t('meetingDetailsText: video without a link promises one, never asserts a fake URL', () => {
  const s = meetingDetailsText({ meetingMode: 'video', joinUrl: null })
  assert.match(s, /sent to you shortly/i)
  assert.doesNotMatch(s, /https?:\/\//)
})
t('meetingDetailsText: phone and in_person copy', () => {
  assert.match(meetingDetailsText({ meetingMode: 'phone', phone: '555-1212' }), /call you at 555-1212/)
  assert.match(meetingDetailsText({ meetingMode: 'in_person', location: '12800 Westridge' }), /12800 Westridge/)
})
t('no meeting-details copy contains recommendation language (green-zone)', () => {
  for (const mode of ['video', 'phone', 'in_person']) {
    const s = meetingDetailsText({ meetingMode: mode, joinUrl: 'x', phone: 'y', location: 'z' })
    assert.doesNotMatch(s, /recommend|you should|buy|purchase|invest in/i)
  }
})

t('buildBookingContext derives first_name and fills the merge tokens', () => {
  const ctx = buildBookingContext({
    fullName: 'Dana Rivers',
    startsAt: '2026-08-03T14:00:00Z',
    bookerTimezone: 'America/Chicago',
    meetingMode: 'video',
    joinUrl: 'https://zoom.us/j/9',
  })
  assert.equal(ctx.first_name, 'Dana')
  assert.equal(ctx.full_name, 'Dana Rivers')
  assert.match(ctx.appointment_time, /August 3, 2026/)
  assert.match(ctx.meeting_details, /zoom\.us/)
})
t('buildBookingContext degrades to "there" when no name is known', () => {
  const ctx = buildBookingContext({ fullName: null, startsAt: '2026-08-03T14:00:00Z', bookerTimezone: 'UTC', meetingMode: 'phone' })
  assert.equal(ctx.first_name, 'there')
})

console.log('isReminderDue')
const now = new Date('2026-08-02T15:00:00Z') // 23h before a 2026-08-03T14:00Z start
const base = { status: 'scheduled', startsAt: '2026-08-03T14:00:00Z', bookedAt: '2026-07-01T00:00:00Z', reminderSentAt: null }
t('due inside the lead window for a scheduled, unsent, early-booked appointment', () => {
  assert.equal(isReminderDue(base, now, 24), true)
})
t('not due once already reminded', () => {
  assert.equal(isReminderDue({ ...base, reminderSentAt: '2026-08-02T15:00:00Z' }, now, 24), false)
})
t('not due for a non-scheduled status', () => {
  assert.equal(isReminderDue({ ...base, status: 'cancelled' }, now, 24), false)
})
t('not due too early (before the window opens)', () => {
  const early = new Date('2026-08-01T00:00:00Z') // >24h before start
  assert.equal(isReminderDue(base, early, 24), false)
})
t('not due after the appointment start', () => {
  const after = new Date('2026-08-03T15:00:00Z')
  assert.equal(isReminderDue(base, after, 24), false)
})
t('not due when the booking itself was made inside the lead window (confirmation suffices)', () => {
  assert.equal(isReminderDue({ ...base, bookedAt: '2026-08-02T18:00:00Z' }, now, 24), false)
})
t('default lead is 24h', () => {
  assert.equal(DEFAULT_REMINDER_LEAD_HOURS, 24)
})

// B-3 — the transactional fallback content is fail-closed by construction: for EVERY lifecycle
// event it produces a non-empty subject/heading/lede AND rows that state WHAT + WHEN + HOW, so a
// template-not-approved fallback can never ship an empty/placeholder message.
console.log('buildBookingFallbackContent (B-3 fallback)')
const fbInp = {
  agent: 'Markist Reed', typeName: 'Coverage Review', name: 'Dana',
  appointmentTime: 'Monday, August 3, 2026 at 9:00 AM CDT',
  meetingDetails: 'Join your video meeting here: https://zoom.us/j/9',
  rescheduleUrl: 'https://x/schedule?manage=r', cancelUrl: 'https://x/schedule?manage=c',
  scheduleUrl: 'https://x/schedule',
}
for (const ev of ['rescheduled', 'cancellation', 'reminder', 'no_show_followup', 'recap', 'unknown_event']) {
  t(`fallback content for "${ev}" is non-empty and states what/when`, () => {
    const c = buildBookingFallbackContent(ev, fbInp)
    assert.ok(c.subject.trim().length > 0, 'subject non-empty')
    assert.ok(c.heading.trim().length > 0, 'heading non-empty')
    assert.ok(c.lede.trim().length > 0, 'lede non-empty')
    assert.ok(c.rows.some((r) => r.value === fbInp.appointmentTime), 'carries the appointment time')
    assert.ok(c.rows.some((r) => r.value === 'Coverage Review'), 'carries the appointment type')
    // Green-zone: no recommendation language in any fallback copy.
    assert.doesNotMatch(`${c.subject} ${c.heading} ${c.lede} ${c.note}`, /you should (buy|invest|convert|roll)/i)
  })
}
t('fallback degrades name to "there" and typeName to a safe default when unknown', () => {
  const c = buildBookingFallbackContent('reminder', { ...fbInp, name: '', typeName: '' })
  assert.match(c.heading, /there/)
  assert.ok(c.rows.some((r) => r.value === 'your appointment'))
})
t('cancellation + no_show point the client to rebooking (never a dead end)', () => {
  for (const ev of ['cancellation', 'no_show_followup']) {
    assert.match(buildBookingFallbackContent(ev, fbInp).note, /rebook/i)
  }
})

console.log(`\nAll ${passed} assertions passed.`)
