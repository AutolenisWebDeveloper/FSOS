// src/lib/booking/ics.ts
// Pure iCalendar (.ics) builder for the booking "add to calendar" action. No dependencies,
// no clock reads — deterministic given its inputs, so it is unit-provable and safe to run
// client-side. RFC 5545 escaping is applied to all text fields.

export interface IcsEvent {
  uid: string
  title: string
  description?: string
  location?: string
  startsAt: string // UTC ISO
  endsAt: string // UTC ISO
  /** DTSTAMP; defaults to startsAt (kept explicit so output is deterministic). */
  stamp?: string
}

/** RFC 5545 basic-format UTC timestamp: 20260803T140000Z. */
export function toIcsUtc(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ISO timestamp: ${iso}`)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/** Escape a text value for an ICS property (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Build a single-event VCALENDAR string with CRLF line endings. */
export function buildIcs(ev: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FSOS//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(ev.uid)}`,
    `DTSTAMP:${toIcsUtc(ev.stamp ?? ev.startsAt)}`,
    `DTSTART:${toIcsUtc(ev.startsAt)}`,
    `DTEND:${toIcsUtc(ev.endsAt)}`,
    `SUMMARY:${escapeIcsText(ev.title)}`,
  ]
  if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`)
  if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}
