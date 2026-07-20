import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkshopCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { slugify } from '@/lib/workshops/logic'
import { syncPresenters, recordMaterial } from '@/lib/workshops/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/workshops — create a workshop (spec §8 authoring). Starts in 'draft'. Also
// seeds a 1:1 workshop_session (scaffold is single scheduled_at), attaches reusable
// presenters, and auto-flags is_security when a third-party/fund-family presenter is
// attached. Publishing is a separate, compliance-gated action. Roles: fsa/licensed_staff/admin.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WorkshopCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid workshop', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const startsAt = new Date(v.data.scheduled_at).toISOString()

    // Unique slug: slugify(title), disambiguate on collision.
    let slug = slugify(v.data.title) || 'workshop'
    const { data: clash } = await db.from('workshops').select('workshop_id').eq('slug', slug).maybeSingle()
    if (clash) slug = `${slug}-${randomUUID().slice(0, 6)}`

    const { data, error } = await db
      .from('workshops')
      .insert({
        title: v.data.title,
        topic: v.data.topic,
        slug,
        description: v.data.description ?? null,
        agenda: v.data.agenda ?? null,
        scheduled_at: startsAt,
        delivery_mode: v.data.delivery_mode,
        host_name: v.data.host_name ?? null,
        location: v.data.venue_address ?? v.data.location ?? null,
        max_attendees: v.data.max_attendees ?? 50,
        hero_image_ref: v.data.hero_image_ref ?? null,
        status: 'draft',
      })
      .select('workshop_id')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    const workshopId = data.workshop_id

    // Seed the 1:1 session mirroring the scheduled time + venue.
    await db.from('workshop_sessions').insert({
      workshop_id: workshopId,
      starts_at: startsAt,
      timezone: v.data.timezone ?? 'America/Chicago',
      delivery_mode: v.data.delivery_mode,
      venue_name: v.data.venue_name ?? null,
      venue_address: v.data.venue_address ?? v.data.location ?? null,
      capacity_in_person: v.data.capacity_in_person ?? null,
      capacity_virtual: v.data.capacity_virtual ?? null,
      ics_uid: `wshop-${workshopId}@fsos`,
    })

    // Attach presenters (recomputes + persists is_security) and snapshot hero image.
    if (v.data.presenter_ids && v.data.presenter_ids.length > 0) {
      await syncPresenters(db, workshopId, v.data.presenter_ids)
    }
    if (v.data.hero_image_ref) {
      await recordMaterial(db, { workshopId, kind: 'hero_image', storageRef: v.data.hero_image_ref })
    }

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'workshop',
      entityId: workshopId,
      diff: { title: v.data.title, topic: v.data.topic, slug, delivery_mode: v.data.delivery_mode },
    })
    return NextResponse.json({ workshop_id: workshopId, slug }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create workshop' }, { status: 500 })
  }
}
