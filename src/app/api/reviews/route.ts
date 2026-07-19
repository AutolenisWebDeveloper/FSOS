import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { ReviewCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-06 Financial Review — the connective spine (WF-2).
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const url = new URL(req.url)
    const household = url.searchParams.get('household')
    const stage = url.searchParams.get('stage')
    let q = getDb().from('reviews').select('*').is('deleted_at', null).order('scheduled_at', { ascending: true, nullsFirst: false })
    if (household) q = q.eq('household_id', household)
    if (stage) q = q.eq('stage', stage)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ reviews: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ReviewCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid review', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // Pull the agenda template for this type (config; assumption-flagged where Farmers-specific).
    const { data: rt } = await db.from('review_types').select('agenda').eq('key', v.data.type).maybeSingle()
    const scheduledAt = v.data.scheduled_at ? new Date(v.data.scheduled_at).toISOString() : null

    const { data, error } = await db
      .from('reviews')
      .insert({
        household_id: v.data.household_id,
        type: v.data.type,
        stage: scheduledAt ? 'scheduled' : 'requested',
        scheduled_at: scheduledAt,
        agenda: rt?.agenda ?? [],
        assigned_user: v.data.assigned_user ?? null,
        owner_scope: actor,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    // Schedule → appointment (manual fallback; Google Calendar 🔌 when connected) + prep task.
    if (scheduledAt) {
      await db.from('appointments').insert({ household_id: v.data.household_id, review_id: data.id, scheduled_at: scheduledAt, status: 'scheduled' })
    }
    await db.from('work_tasks').insert({
      title: `Prep ${v.data.type.replace(/_/g, ' ')} review`,
      entity_type: 'review',
      entity_id: data.id,
      source: 'workflow',
      due_at: scheduledAt,
      owner_scope: actor,
    })

    await writeAudit({ actor, action: 'entity.created', entity: 'review', entityId: data.id, diff: { household_id: data.household_id, type: data.type } })
    return NextResponse.json({ review: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create review' }, { status: 500 })
  }
}
