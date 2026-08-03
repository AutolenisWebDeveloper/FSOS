// src/lib/booking/display.ts
// Small pure display helpers shared by the booking-config server page and its client
// islands (labels only — no React, no 'use client', safe on both sides).

export const WEEKDAYS = [
  { value: 0, short: 'Sun', long: 'Sunday' },
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
] as const

export function weekdayLabel(weekday: number, form: 'short' | 'long' = 'long'): string {
  return WEEKDAYS.find((d) => d.value === weekday)?.[form] ?? '—'
}

export const MEETING_MODE_LABELS: Record<string, string> = {
  video: 'Video (Zoom)',
  phone: 'Phone',
  in_person: 'In person',
}

export function meetingModeLabel(mode: string | null | undefined): string {
  return mode ? MEETING_MODE_LABELS[mode] ?? mode : '—'
}

/** A short, common IANA-zone shortlist for the config timezone picker (free text still allowed). */
export const COMMON_TIMEZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
] as const

/** "9:00 AM" from an "HH:MM" 24h wall time (config display only). */
export function formatWallTime(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return hhmm
  let h = Number.parseInt(m[1], 10)
  const min = m[2]
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${min} ${ampm}`
}

// ── Time-of-day grouping (public booking time picker) ──────────────────────────────
// Pure presentational bucketing so the day's open times can be shown under Morning /
// Afternoon / Evening headings. Operates on the availability API's `localTime` ("HH:MM",
// already in the booker's chosen zone) — no clock, no timezone math, no engine logic.

export type TimeOfDay = 'morning' | 'afternoon' | 'evening'

/** Bucket an "HH:MM" wall time: <12:00 morning, 12:00–16:59 afternoon, ≥17:00 evening. */
export function timeOfDayBucket(hhmm: string): TimeOfDay {
  const m = /^(\d{1,2}):/.exec(hhmm)
  const h = m ? Number.parseInt(m[1], 10) : NaN
  if (Number.isNaN(h) || h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

/** The time-of-day sections in render order (label + bucket key). */
export const TIME_OF_DAY_SECTIONS: { key: TimeOfDay; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
]
