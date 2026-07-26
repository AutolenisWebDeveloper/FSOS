// src/lib/booking/availability.ts
// The PURE availability calculator for the native booking engine (§1.3). Deliberately
// DB-free: it takes availability rules, an appointment type, existing appointments,
// blackouts, and external busy blocks as plain data and returns the bookable slots — so it
// is fully unit-provable offline (the same discipline as lib/appointments/recovery.ts).
//
// bookable slots = availability rules  (host weekly hours, in the host's IANA zone)
//                − existing appointments (expanded by the type's buffers)
//                − blackouts
//                − external busy blocks (Google busy-sync, later slice — empty for now)
//                − outside [now + minNotice, now + maxLeadDays]
//                − any day already at the type's max-per-day capacity
// rendered in the BOOKER's timezone.
//
// All instants are UTC (ISO strings in / ISO strings + rendered local out). All wall-clock
// reasoning goes through ./timezone.ts (Intl-backed, DST-correct). There is NO naive
// timestamp math here.

import {
  zonedTimeToUtc,
  weekdayOfDate,
  parseHHMM,
  localDateKey,
  humanLabel,
  offsetLabel,
  wallParts,
} from './timezone'

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000

/** The bookable-appointment definition the calculator needs (subset of appointment_types). */
export interface AppointmentTypeConfig {
  id?: string
  durationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  minNoticeMinutes: number
  maxLeadDays: number
  /** null / undefined = unlimited. */
  maxPerDay?: number | null
  /** Slot-start granularity; defaults to durationMinutes when omitted. */
  slotIntervalMinutes?: number
}

/** One recurring weekly availability window (a row of availability_rules). */
export interface AvailabilityRule {
  weekday: number // 0=Sunday … 6=Saturday
  startTime: string // "HH:MM" wall clock in `timezone`
  endTime: string // "HH:MM" wall clock in `timezone`
  timezone: string // IANA zone the wall times are expressed in
  effectiveStart?: string | null // "YYYY-MM-DD" inclusive, or null = always
  effectiveEnd?: string | null // "YYYY-MM-DD" inclusive, or null = always
  active?: boolean // defaults true
}

/** A busy interval (existing appointment / blackout / external-calendar block), UTC ISO. */
export interface BusyBlock {
  startsAt: string
  endsAt: string
}

export interface SlotRequest {
  type: AppointmentTypeConfig
  rules: AvailabilityRule[]
  /** Confirmed appointments to subtract; the type's buffers are applied around each. */
  existingAppointments?: BusyBlock[]
  blackouts?: BusyBlock[]
  /** Google Calendar busy blocks (later slice); empty today. Subtracted raw (no buffer). */
  externalBusy?: BusyBlock[]
  /** Window to compute, UTC ISO. Only slots with start in [rangeStart, rangeEnd] are returned. */
  rangeStart: string
  rangeEnd: string
  /** The booker's IANA zone — slots are rendered (labelled) in this zone. */
  bookerTimezone: string
  /** "Now", UTC ISO — drives min-notice and max-lead. */
  now: string
  /**
   * The host's IANA zone used to bucket per-day capacity (max_per_day). Defaults to the
   * first rule's zone. Single-practice deployments have one zone, so this is unambiguous.
   */
  capacityTimezone?: string
}

export interface RenderedSlot {
  /** UTC ISO start/end — what gets persisted on booking. */
  startsAt: string
  endsAt: string
  durationMinutes: number
  /** Booker-local rendering (never used for storage — display only). */
  bookerTimezone: string
  localDate: string // "YYYY-MM-DD" in the booker's zone
  localTime: string // "HH:MM" 24h in the booker's zone
  label: string // e.g. "Mon, Jul 27, 9:00 AM"
  offset: string // e.g. "-05:00"
}

/** True iff [aStart,aEnd) and [bStart,bEnd) overlap (touching edges do NOT overlap). */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/** Slot passes the min-notice floor: it starts at or after now + minNotice. */
export function withinMinNotice(slotStartMs: number, nowMs: number, minNoticeMinutes: number): boolean {
  return slotStartMs >= nowMs + minNoticeMinutes * MS_PER_MINUTE
}

/** Slot passes the max-lead ceiling: it starts at or before now + maxLeadDays. */
export function withinMaxLead(slotStartMs: number, nowMs: number, maxLeadDays: number): boolean {
  return slotStartMs <= nowMs + maxLeadDays * MS_PER_DAY
}

/**
 * Compute the bookable slots for one appointment type over a window, in the booker's zone.
 * Pure and deterministic: same inputs → same ordered output (ascending by start).
 */
export function computeAvailableSlots(req: SlotRequest): RenderedSlot[] {
  const {
    type,
    rules,
    rangeStart,
    rangeEnd,
    bookerTimezone,
    now,
  } = req
  const nowMs = Date.parse(now)
  const rangeStartMs = Date.parse(rangeStart)
  const rangeEndMs = Date.parse(rangeEnd)
  if (!Number.isFinite(nowMs) || !Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) {
    throw new Error('computeAvailableSlots: now/rangeStart/rangeEnd must be valid ISO timestamps')
  }
  const duration = type.durationMinutes
  const interval = type.slotIntervalMinutes && type.slotIntervalMinutes > 0 ? type.slotIntervalMinutes : duration
  const activeRules = rules.filter((r) => r.active !== false)
  const capacityTz = req.capacityTimezone ?? activeRules[0]?.timezone ?? bookerTimezone

  // Pre-expand the busy sources. Existing appointments are widened by the type's buffers so a
  // new slot keeps buffer_before free before it and buffer_after free after it; blackouts and
  // external busy subtract raw.
  const bufBeforeMs = type.bufferBeforeMinutes * MS_PER_MINUTE
  const bufAfterMs = type.bufferAfterMinutes * MS_PER_MINUTE
  const busyWithBuffer: Array<[number, number]> = (req.existingAppointments ?? []).map((b) => [
    Date.parse(b.startsAt) - bufAfterMs, // a slot ending here would violate the trailing buffer of the prior appt
    Date.parse(b.endsAt) + bufBeforeMs, // a slot starting here would violate the leading buffer of the next appt
  ])
  const busyRaw: Array<[number, number]> = [...(req.blackouts ?? []), ...(req.externalBusy ?? [])].map((b) => [
    Date.parse(b.startsAt),
    Date.parse(b.endsAt),
  ])

  // Per-day capacity: how many confirmed appointments already sit on each host-local day.
  const perDayBooked = new Map<string, number>()
  if (type.maxPerDay != null) {
    for (const b of req.existingAppointments ?? []) {
      const key = localDateKey(new Date(Date.parse(b.startsAt)), capacityTz)
      perDayBooked.set(key, (perDayBooked.get(key) ?? 0) + 1)
    }
  }

  // Candidate slots, deduped by start instant (overlapping rules can emit the same start).
  const seen = new Set<number>()
  const candidates: Array<{ startMs: number; endMs: number }> = []

  // Iterate calendar dates spanning the window, padded ±1 day so a rule whose wall time maps
  // to an adjacent UTC date is not missed. Weekday of a calendar date is zone-independent.
  for (const { year, month, day } of eachCalendarDate(rangeStartMs - MS_PER_DAY, rangeEndMs + MS_PER_DAY)) {
    const weekday = weekdayOfDate(year, month, day)
    const dateKey = `${pad4(year)}-${pad2(month)}-${pad2(day)}`
    for (const rule of activeRules) {
      if (rule.weekday !== weekday) continue
      if (rule.effectiveStart && dateKey < rule.effectiveStart) continue
      if (rule.effectiveEnd && dateKey > rule.effectiveEnd) continue

      const startMin = parseHHMM(rule.startTime)
      const endMin = parseHHMM(rule.endTime)
      for (let slotMin = startMin; slotMin + duration <= endMin; slotMin += interval) {
        const h = Math.floor(slotMin / 60)
        const m = slotMin % 60
        const startMs = zonedTimeToUtc(year, month, day, h, m, rule.timezone).getTime()
        if (seen.has(startMs)) continue
        seen.add(startMs)
        candidates.push({ startMs, endMs: startMs + duration * MS_PER_MINUTE })
      }
    }
  }

  candidates.sort((a, b) => a.startMs - b.startMs)

  const out: RenderedSlot[] = []
  for (const c of candidates) {
    // Window bound.
    if (c.startMs < rangeStartMs || c.startMs > rangeEndMs) continue
    // Notice / lead bounds.
    if (!withinMinNotice(c.startMs, nowMs, type.minNoticeMinutes)) continue
    if (!withinMaxLead(c.startMs, nowMs, type.maxLeadDays)) continue
    // Buffered existing appointments.
    if (busyWithBuffer.some(([bs, be]) => overlaps(c.startMs, c.endMs, bs, be))) continue
    // Blackouts + external busy (raw).
    if (busyRaw.some(([bs, be]) => overlaps(c.startMs, c.endMs, bs, be))) continue
    // Per-day capacity.
    if (type.maxPerDay != null) {
      const key = localDateKey(new Date(c.startMs), capacityTz)
      if ((perDayBooked.get(key) ?? 0) >= type.maxPerDay) continue
    }
    out.push(renderSlot(c.startMs, c.endMs, duration, bookerTimezone))
  }
  return out
}

function renderSlot(startMs: number, endMs: number, duration: number, tz: string): RenderedSlot {
  const start = new Date(startMs)
  const wp = wallParts(start, tz)
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(endMs).toISOString(),
    durationMinutes: duration,
    bookerTimezone: tz,
    localDate: `${pad4(wp.year)}-${pad2(wp.month)}-${pad2(wp.day)}`,
    localTime: `${pad2(wp.hour)}:${pad2(wp.minute)}`,
    label: humanLabel(start, tz),
    offset: offsetLabel(start, tz),
  }
}

/** Yield {year,month,day} for every UTC calendar date in [startMs, endMs] inclusive. */
function* eachCalendarDate(startMs: number, endMs: number): Generator<{ year: number; month: number; day: number }> {
  const d = new Date(startMs)
  let y = d.getUTCFullYear()
  let mo = d.getUTCMonth() // 0-11
  let day = d.getUTCDate()
  let cursor = Date.UTC(y, mo, day)
  const end = endMs
  // Guard against pathological ranges (cap at ~2 years of days).
  let guard = 0
  while (cursor <= end && guard < 800) {
    const cd = new Date(cursor)
    y = cd.getUTCFullYear()
    mo = cd.getUTCMonth()
    day = cd.getUTCDate()
    yield { year: y, month: mo + 1, day }
    cursor += MS_PER_DAY
    guard++
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
function pad4(n: number): string {
  return String(n).padStart(4, '0')
}
