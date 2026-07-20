// src/lib/workshops/public.ts
// Server-only loader for the PUBLIC workshop pages (hub excluded — it lists directly).
// Loads a PUBLISHED workshop by slug with its session, presenters (signed headshot URLs),
// hero image, approved disclosure text, and seat availability. Never returns a draft or
// unpublished workshop, and only surfaces APPROVED (non-placeholder) disclosure text.

import { getDb } from '@/lib/supabase/client'
import { signedAssetUrl } from './server'

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

  // Earliest session.
  const { data: session } = await db
    .from('workshop_sessions')
    .select('id, starts_at, timezone, venue_name, venue_address, delivery_mode')
    .eq('workshop_id', w.workshop_id)
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
    .select('workshop_id, starts_at, delivery_mode, venue_name, venue_address')
    .in('workshop_id', ids)
    .order('starts_at', { ascending: true })
  const earliest = new Map<string, { starts_at: string; delivery_mode: string | null; venue_name: string | null; venue_address: string | null }>()
  for (const s of (sessions ?? []) as { workshop_id: string; starts_at: string; delivery_mode: string | null; venue_name: string | null; venue_address: string | null }[]) {
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
