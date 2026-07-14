import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/activities — log an activity against any spine entity (A3 "log activity").
// A contact/check-in activity also stamps the agency's last_contact_at so the
// dormancy view (v_agencies_overdue_checkin) stays accurate.
const Schema = z.object({
  entity_type: z.string().trim().min(1).max(60),
  entity_id: z.string().uuid(),
  kind: z.string().trim().min(1).max(40).default('note'),
  note: z.string().trim().min(1).max(2000),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = Schema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid activity', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('activities')
      .insert({ entity_type: v.data.entity_type, entity_id: v.data.entity_id, kind: v.data.kind, note: v.data.note, actor })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (v.data.entity_type === 'agency_partnership' && ['contact', 'checkin', 'note'].includes(v.data.kind)) {
      await db.from('agency_partnerships').update({ last_contact_at: new Date().toISOString() }).eq('id', v.data.entity_id)
    }

    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: v.data.entity_type,
      entityId: v.data.entity_id,
      diff: { activity: v.data.kind, note: v.data.note },
    })
    return NextResponse.json({ activity: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
