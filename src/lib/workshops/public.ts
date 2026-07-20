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
