// src/lib/booking/timezone.ts
// DST-correct IANA timezone math for the native booking engine — DEPENDENCY-FREE.
//
// Booking is a timezone problem first and a scheduling problem second (§1.1). The booker
// and the FSA can be in different zones, availability rules are expressed in the host's
// wall-clock time, and a recurring "9:00 AM Monday" rule must stay 9:00 AM local across the
// spring/fall DST shift. We do all of that on top of the platform `Intl` timezone database
// (which knows every zone's DST rules) rather than pulling in a date library, so the pure
// availability calculator (./availability.ts) can be unit-proven offline with no install.
//
// Every function here is pure. Instants are always JS Date (UTC epoch ms); wall-clock times
// are always paired with an explicit IANA zone. There is NO naive-timestamp arithmetic.

/**
 * The signed offset, in MINUTES east of UTC, in effect in `timeZone` at the given instant.
 * America/Chicago in summer (CDT) → -300; in winter (CST) → -360. Computed by asking Intl
 * for the wall-clock components of the instant in that zone and differencing them from the
 * instant itself, so DST is always applied exactly as the zone database defines it.
 */
export function getOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = wallParts(instant, timeZone)
  // The wall-clock reading in `timeZone`, re-interpreted as if it were a UTC timestamp.
  const asUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return Math.round((asUtcMs - instant.getTime()) / 60000)
}

/**
 * Convert a WALL-CLOCK time in `timeZone` to the UTC instant it denotes. Two-pass so a wall
 * time that lands on/near a DST transition resolves to the correct offset (the offset at the
 * naive guess can differ from the offset at the true instant — e.g. across "spring forward").
 * A wall time in the spring-forward gap (which does not exist) resolves to the adjacent valid
 * instant; an ambiguous fall-back wall time resolves deterministically to one of its instants.
 * The availability calculator only ever feeds valid in-hours wall times, so neither edge is
 * user-visible, but the math is defined for both.
 */
export function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naiveGuessMs = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offset1 = getOffsetMinutes(new Date(naiveGuessMs), timeZone)
  let utcMs = naiveGuessMs - offset1 * 60000
  const offset2 = getOffsetMinutes(new Date(utcMs), timeZone)
  if (offset2 !== offset1) utcMs = naiveGuessMs - offset2 * 60000
  return new Date(utcMs)
}

/** The wall-clock calendar components of an instant, read in `timeZone`. */
export interface WallParts {
  year: number
  month: number // 1-12
  day: number
  hour: number // 0-23
  minute: number
  second: number
  weekday: number // 0=Sunday … 6=Saturday
}

/** Read the wall-clock components (Y-M-D H:M:S + weekday) of an instant in `timeZone`. */
export function wallParts(instant: Date, timeZone: string): WallParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(instant)) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  // Some engines emit hour "24" at midnight under h23; normalize to 0.
  let hour = Number.parseInt(map.hour ?? '0', 10)
  if (hour === 24) hour = 0
  return {
    year: Number.parseInt(map.year, 10),
    month: Number.parseInt(map.month, 10),
    day: Number.parseInt(map.day, 10),
    hour,
    minute: Number.parseInt(map.minute ?? '0', 10),
    second: Number.parseInt(map.second ?? '0', 10),
    weekday: WEEKDAY_INDEX[map.weekday] ?? new Date(instant).getUTCDay(),
  }
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/** The `YYYY-MM-DD` calendar-day key of an instant IN `timeZone` (for per-day capacity). */
export function localDateKey(instant: Date, timeZone: string): string {
  const p = wallParts(instant, timeZone)
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`
}

/** The signed UTC-offset label (e.g. `-05:00`) in effect in `timeZone` at `instant`. */
export function offsetLabel(instant: Date, timeZone: string): string {
  const off = getOffsetMinutes(instant, timeZone)
  const sign = off <= 0 ? '-' : '+' // note: -300 (CDT) → "-05:00"
  const abs = Math.abs(off)
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

/** The day-of-week (0=Sun…6=Sat) of a CALENDAR date — timezone-independent by definition. */
export function weekdayOfDate(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Parse `"HH:MM"` (24h) into minutes past midnight, or throw on malformed input. */
export function parseHHMM(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) throw new Error(`Invalid HH:MM time: "${value}"`)
  const h = Number.parseInt(m[1], 10)
  const min = Number.parseInt(m[2], 10)
  if (h < 0 || h > 24 || min < 0 || min > 59) throw new Error(`Out-of-range HH:MM time: "${value}"`)
  return h * 60 + min
}

/** A short human label for an instant rendered in a viewer's zone (e.g. "Mon, Jul 27, 9:00 AM"). */
export function humanLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(instant)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
function pad4(n: number): string {
  return String(n).padStart(4, '0')
}
