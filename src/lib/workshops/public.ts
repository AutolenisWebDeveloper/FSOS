// src/lib/workshops/public.ts
// Server-only loader for the PUBLIC workshop pages (hub excluded — it lists directly).
// Loads a PUBLISHED workshop by slug with its session, presenters (signed headshot URLs),
// hero image, approved disclosure text, and seat availability. Never returns a draft or
// unpublished workshop, and only surfaces APPROVED (non-placeholder) disclosure text.

import { getDb } from '@/lib/supabase/client'
import { signedAssetUrl } from './server'

// WS-051: every public-funnel date renders in the VENUE's IANA zone, formatted on the
// SERVER so client hydration cannot swap it to the viewer's zone. The zone abbreviation
// is included so a distant reader knows whose 6:00 PM it is.
export function formatInVenueZone(
  iso: string | null | undefined,
  timeZone: string | null | undefined,
  style: 'full' | 'short' | 'time' = 'full',
): string | null {
  if (!iso) return null
  const tz = timeZone || 'America/Chicago'
  try {
    if (style === 'time') {
      return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))
    }
    if (style === 'short') {
      return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))
    }
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso)) +
      ' ' + (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value ?? '')
  } catch {
    return new Date(iso).toUTCString()
  }
}

export interface PublicPresenter {
  name: string
  title: string | null
  firm: string | null
  fund_family: string | null
  bio: string | null
  headshot_url: string | null
}

export interface PublicWorkshopFull {
  workshop_id: string
  slug: string
  title: string
  topic: string
  description: string | null
  agenda: string | null
  delivery_mode: 'in_person' | 'virtual' | 'hybrid'
  host_name: string | null
  scheduled_at: string | null
  location: string | null
  hero_url: string | null
  session_id: string | null
  venue_name: string | null
  venue_address: string | null
  timezone: string | null
  /** Server-formatted session start in the VENUE zone (WS-051). */
  when_local: string | null
  /** Server-formatted start TIME (venue zone, with zone abbreviation). */
  time_local: string | null
  presenters: PublicPresenter[]
  sms_disclosure: string | null
  seats_remaining: number | null
  is_full: boolean
}

export async function loadPublicWorkshop(slug: string): Promise<PublicWorkshopFull | null> {
  const db = getDb()
  const { data: w } = await db
    .from('workshops')
    .select(
      'workshop_id, slug, title, topic, description, agenda, delivery_mode, host_name, scheduled_at, location, hero_image_ref, max_attendees, disclosure_config_id, status',
    )
    .eq('slug', slug)
    .maybeSingle()
  if (!w || w.status !== 'published') return null

  // Earliest UPCOMING session (a past one must not present as registerable — WS-037).
  const { data: session } = await db
    .from('workshop_sessions')
    .select('id, starts_at, timezone, venue_name, venue_address, delivery_mode')
    .eq('workshop_id', w.workshop_id)
    .neq('status', 'cancelled')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Presenters (ordered) with signed headshot URLs.
  const { data: pres } = await db
    .from('workshop_presenters')
    .select('display_order, presenters(name, title, firm, fund_family, bio, headshot_ref)')
    .eq('workshop_id', w.workshop_id)
    .order('display_order', { ascending: true })
  const presenters: PublicPresenter[] = await Promise.all(
    ((pres as unknown as { presenters: RawPresenter | null }[]) ?? [])
      .map((r) => r.presenters)
      .filter((p): p is RawPresenter => !!p)
      .map(async (p) => ({
        name: p.name,
        title: p.title,
        firm: p.firm,
        fund_family: p.fund_family,
        bio: p.bio,
        headshot_url: await signedAssetUrl(db, p.headshot_ref),
      })),
  )

  // Approved disclosure text (never placeholder — a published workshop has passed the gate).
  let smsDisclosure: string | null = null
  if (w.disclosure_config_id) {
    const { data: d } = await db
      .from('workshop_disclosure_configs')
      .select('body, is_assumption')
      .eq('id', w.disclosure_config_id)
      .maybeSingle()
    if (d && d.is_assumption === false) smsDisclosure = d.body
  }

  // Seat availability.
  const { count } = await db
    .from('workshop_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('workshop_id', w.workshop_id)
  const registered = count ?? 0
  const seatsRemaining = w.max_attendees ? Math.max(0, w.max_attendees - registered) : null
  const isFull = !!w.max_attendees && registered >= w.max_attendees

  return {
    workshop_id: w.workshop_id,
    slug: w.slug,
    title: w.title,
    topic: w.topic,
    description: w.description,
    agenda: w.agenda,
    delivery_mode: (w.delivery_mode as PublicWorkshopFull['delivery_mode']) ?? 'in_person',
    host_name: w.host_name,
    scheduled_at: w.scheduled_at,
    location: w.location,
    hero_url: await signedAssetUrl(db, w.hero_image_ref),
    session_id: session?.id ?? null,
    venue_name: session?.venue_name ?? null,
    venue_address: session?.venue_address ?? w.location ?? null,
    timezone: session?.timezone ?? null,
    when_local: formatInVenueZone(session?.starts_at ?? w.scheduled_at, session?.timezone),
    time_local: formatInVenueZone(session?.starts_at ?? w.scheduled_at, session?.timezone, 'time'),
    presenters,
    sms_disclosure: smsDisclosure,
    seats_remaining: seatsRemaining,
    is_full: isFull,
  }
}

interface RawPresenter {
  name: string
  title: string | null
  firm: string | null
  fund_family: string | null
  bio: string | null
  headshot_ref: string | null
}

// ── Hub list loader (/workshops) ────────────────────────────────────────────────

export interface PublicWorkshopCard {
  workshop_id: string
  slug: string | null
  title: string
  topic: string
  description: string | null
  delivery_mode: 'in_person' | 'virtual' | 'hybrid'
  host_name: string | null
  /** Earliest upcoming session start (UTC ISO), or the workshop's scheduled_at fallback. */
  starts_at: string | null
  /** Server-formatted start in the VENUE zone (WS-051 — never re-format client-side). */
  when_local: string | null
  venue_city: string | null
  location: string | null
  /** Presenter labels for display + filtering (name, and firm/fund when present). */
  presenters: { name: string; org: string | null }[]
  seats_remaining: number | null
  is_full: boolean
}

/**
 * Load every PUBLISHED workshop for the public hub with the fields the cards + filters
 * need — earliest session date/format, presenter labels, and seat availability. Published
 * is the ONLY gate (the compliance publish gate is upstream); drafts never appear. Batched
 * (no N+1): one query each for workshops, sessions, presenters, and registration counts.
 */
export async function loadPublicWorkshops(): Promise<PublicWorkshopCard[]> {
  const db = getDb()
  const { data: ws } = await db
    .from('workshops')
    .select('workshop_id, slug, title, topic, description, delivery_mode, host_name, scheduled_at, location, max_attendees')
    .eq('status', 'published')
  const workshops = (ws ?? []) as {
    workshop_id: string
    slug: string | null
    title: string
    topic: string
    description: string | null
    delivery_mode: string | null
    host_name: string | null
    scheduled_at: string | null
    location: string | null
    max_attendees: number | null
  }[]
  if (workshops.length === 0) return []
  const ids = workshops.map((w) => w.workshop_id)

  // Earliest session per workshop.
  const { data: sessions } = await db
    .from('workshop_sessions')
    .select('workshop_id, starts_at, timezone, delivery_mode, venue_name, venue_address')
    .in('workshop_id', ids)
    .neq('status', 'cancelled')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
  const earliest = new Map<string, { starts_at: string; timezone: string | null; delivery_mode: string | null; venue_name: string | null; venue_address: string | null }>()
  for (const s of (sessions ?? []) as { workshop_id: string; starts_at: string; timezone: string | null; delivery_mode: string | null; venue_name: string | null; venue_address: string | null }[]) {
    if (!earliest.has(s.workshop_id)) earliest.set(s.workshop_id, s)
  }

  // Presenters per workshop (ordered).
  const { data: wp } = await db
    .from('workshop_presenters')
    .select('workshop_id, display_order, presenters(name, firm, fund_family)')
    .in('workshop_id', ids)
    .order('display_order', { ascending: true })
  const presByWorkshop = new Map<string, { name: string; org: string | null }[]>()
  for (const row of (wp ?? []) as unknown as { workshop_id: string; presenters: { name: string; firm: string | null; fund_family: string | null } | null }[]) {
    if (!row.presenters) continue
    const list = presByWorkshop.get(row.workshop_id) ?? []
    list.push({ name: row.presenters.name, org: row.presenters.fund_family || row.presenters.firm || null })
    presByWorkshop.set(row.workshop_id, list)
  }

  // Registration counts per workshop (one row per registration; tally in JS).
  const { data: regs } = await db.from('workshop_registrations').select('workshop_id').in('workshop_id', ids)
  const regCount = new Map<string, number>()
  for (const r of (regs ?? []) as { workshop_id: string }[]) {
    regCount.set(r.workshop_id, (regCount.get(r.workshop_id) ?? 0) + 1)
  }

  const cards: PublicWorkshopCard[] = workshops.map((w) => {
    const s = earliest.get(w.workshop_id)
    const registered = regCount.get(w.workshop_id) ?? 0
    const seatsRemaining = w.max_attendees ? Math.max(0, w.max_attendees - registered) : null
    return {
      workshop_id: w.workshop_id,
      slug: w.slug,
      title: w.title,
      topic: w.topic,
      description: w.description,
      delivery_mode: (s?.delivery_mode ?? w.delivery_mode ?? 'in_person') as PublicWorkshopCard['delivery_mode'],
      host_name: w.host_name,
      starts_at: s?.starts_at ?? w.scheduled_at,
      when_local: formatInVenueZone(s?.starts_at ?? w.scheduled_at, s?.timezone),
      venue_city: s?.venue_name ?? null,
      location: s?.venue_address ?? w.location,
      presenters: presByWorkshop.get(w.workshop_id) ?? [],
      seats_remaining: seatsRemaining,
      is_full: !!w.max_attendees && registered >= w.max_attendees,
    }
  })

  // Sort by soonest date; undated workshops sort last.
  cards.sort((a, b) => {
    const av = a.starts_at ? Date.parse(a.starts_at) : Infinity
    const bv = b.starts_at ? Date.parse(b.starts_at) : Infinity
    return av - bv
  })
  return cards
}

// ── Registrant self-cancel lookup (WS-009) ──────────────────────────────────────

export interface CancelLookup {
  found: boolean
  already_cancelled: boolean
  past: boolean
  workshop_title: string | null
  when_local: string | null
}

/**
 * Resolve a cancel-link token to just what the confirm page needs to show — the event
 * being cancelled and whether there is anything left to cancel. Token-addressed only
 * (the per-registrant join_token); exposes no other registrant data.
 */
export async function loadRegistrationForCancel(token: string): Promise<CancelLookup> {
  const none: CancelLookup = { found: false, already_cancelled: false, past: false, workshop_title: null, when_local: null }
  if (!token || token.length < 8 || token.length > 200) return none
  const db = getDb()
  const { data: reg } = await db
    .from('workshop_registrations')
    .select('reg_id, workshop_id, session_id, status')
    .eq('join_token', token)
    .maybeSingle()
  if (!reg) return none

  let title: string | null = null
  let whenLocal: string | null = null
  let past = false
  const { data: w } = await db.from('workshops').select('title').eq('workshop_id', reg.workshop_id).maybeSingle()
  title = w?.title ?? null
  if (reg.session_id) {
    const { data: s } = await db
      .from('workshop_sessions')
      .select('starts_at, timezone')
      .eq('id', reg.session_id)
      .maybeSingle()
    if (s?.starts_at) {
      whenLocal = formatInVenueZone(s.starts_at, s.timezone, 'full')
      past = Date.parse(s.starts_at) <= Date.now()
    }
  }
  return {
    found: true,
    already_cancelled: reg.status === 'cancelled',
    past,
    workshop_title: title,
    when_local: whenLocal,
  }
}
