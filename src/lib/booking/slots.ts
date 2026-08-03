// src/lib/booking/slots.ts
// Impure availability assembler for the PUBLIC booking flow (Slice 3). Loads an
// appointment type + its host's availability rules, existing appointments (busy), and
// blackouts, then delegates to the PURE calculator (./availability.ts) to produce the
// bookable slots in the booker's timezone. The pure calculator does all the hard
// timezone/DST/buffer/capacity math; this layer only fetches and shapes DB rows.
//
// Reads run with the service role (getDb) — these tables are RLS default-deny — but the
// PUBLIC route that calls this only ever exposes computed open slots for ONE appointment
// type, never other rows. No securities data is touched (booking stores scheduling only).

import { getDb } from '@/lib/supabase/client'
import { computeAvailableSlots, ruleFromRow, type AvailabilityRule, type AvailabilityRuleRow, type BusyBlock, type RenderedSlot } from './availability'
import { loadGoogleBusy } from './google/busy'

export interface BookableType {
  id: string
  host_user_id: string | null
  name: string
  slug: string
  description: string | null
  duration_minutes: number
  buffer_before_minutes: number
  buffer_after_minutes: number
  min_notice_minutes: number
  max_lead_days: number
  max_per_day: number | null
  slot_interval_minutes: number
  meeting_mode: string
  active: boolean
}

const TYPE_COLUMNS =
  'id, host_user_id, name, slug, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_lead_days, max_per_day, slot_interval_minutes, meeting_mode, active'

export type SlotsResult =
  | { ok: true; type: BookableType; slots: RenderedSlot[] }
  | { ok: false; kind: 'not_found' | 'inactive' | 'error'; message: string }

/** Load one ACTIVE bookable type by public slug. */
export async function loadActiveType(slug: string): Promise<
  { ok: true; type: BookableType } | { ok: false; kind: 'not_found' | 'inactive' | 'error'; message: string }
> {
  const { data, error } = await getDb().from('appointment_types').select(TYPE_COLUMNS).eq('slug', slug).maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'That appointment type does not exist.' }
  const type = data as BookableType
  if (!type.active) return { ok: false, kind: 'inactive', message: 'That appointment type is not currently bookable.' }
  return { ok: true, type }
}

/**
 * Compute the bookable slots for `slug` over [rangeStart, rangeEnd] in the booker's zone.
 * Availability rules + blackouts are scoped to the type's host; busy blocks are that host's
 * scheduled appointments in the window. `now` is injected (never read from the clock here)
 * so callers/tests are deterministic.
 */
export async function computeSlotsForType(args: {
  slug: string
  rangeStart: string
  rangeEnd: string
  bookerTimezone: string
  now: string
}): Promise<SlotsResult> {
  const loaded = await loadActiveType(args.slug)
  if (!loaded.ok) return loaded
  const type = loaded.type
  const db = getDb()

  // Rules + blackouts for this type's host. A null host (practice-wide) matches null-host rules.
  const rulesQ = db
    .from('availability_rules')
    .select('weekday, start_time, end_time, timezone, effective_start, effective_end, active')
    .eq('active', true)
  const blackoutsQ = db.from('availability_blackouts').select('starts_at, ends_at')
  // Busy = this host's still-scheduled appointments overlapping a padded window.
  const busyQ = db
    .from('appointments')
    .select('starts_at, ends_at')
    .eq('status', 'scheduled')
    .not('starts_at', 'is', null)
    .gte('starts_at', isoMinusDays(args.rangeStart, 1))
    .lte('starts_at', isoPlusDays(args.rangeEnd, 1))

  // Google busy-sync (Slice 7): one-way, read-only. Loaded over the same padded window as
  // existing appointments. This NEVER throws and NEVER blocks availability — when Google is
  // not configured / not connected / degraded it returns an empty set (native availability).
  const googleBusyP = loadGoogleBusy({
    hostUserId: type.host_user_id,
    timeMinIso: isoMinusDays(args.rangeStart, 1),
    timeMaxIso: isoPlusDays(args.rangeEnd, 1),
    now: args.now,
  })

  const [rulesRes, blackoutsRes, busyRes, googleBusy] = await Promise.all([
    type.host_user_id ? rulesQ.eq('host_user_id', type.host_user_id) : rulesQ.is('host_user_id', null),
    type.host_user_id ? blackoutsQ.eq('host_user_id', type.host_user_id) : blackoutsQ.is('host_user_id', null),
    type.host_user_id ? busyQ.eq('host_user_id', type.host_user_id) : busyQ.is('host_user_id', null),
    googleBusyP,
  ])
  if (rulesRes.error) return { ok: false, kind: 'error', message: rulesRes.error.message }
  if (blackoutsRes.error) return { ok: false, kind: 'error', message: blackoutsRes.error.message }
  if (busyRes.error) return { ok: false, kind: 'error', message: busyRes.error.message }

  const rules: AvailabilityRule[] = (rulesRes.data ?? []).map((r) => ruleFromRow(r as unknown as AvailabilityRuleRow))
  const blackouts: BusyBlock[] = (blackoutsRes.data ?? []).map((b) => ({
    startsAt: b.starts_at as string,
    endsAt: b.ends_at as string,
  }))
  const existingAppointments: BusyBlock[] = (busyRes.data ?? []).map((a) => ({
    startsAt: a.starts_at as string,
    endsAt: a.ends_at as string,
  }))

  const slots = computeAvailableSlots({
    type: {
      id: type.id,
      durationMinutes: type.duration_minutes,
      bufferBeforeMinutes: type.buffer_before_minutes,
      bufferAfterMinutes: type.buffer_after_minutes,
      minNoticeMinutes: type.min_notice_minutes,
      maxLeadDays: type.max_lead_days,
      maxPerDay: type.max_per_day,
      slotIntervalMinutes: type.slot_interval_minutes,
    },
    rules,
    existingAppointments,
    blackouts,
    externalBusy: googleBusy.busy, // Google busy-sync (Slice 7): [] when unconfigured/degraded.
    rangeStart: args.rangeStart,
    rangeEnd: args.rangeEnd,
    bookerTimezone: args.bookerTimezone,
    now: args.now,
  })
  return { ok: true, type, slots }
}

function isoMinusDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) - days * 86_400_000).toISOString()
}
function isoPlusDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString()
}
