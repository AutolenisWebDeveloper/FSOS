import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { IncidentCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// WF-10 Incident/Breach. Compliance/supervisor/super only. Creating an incident
// starts the Reg S-P/Safeguards clock (30-day affected-notice floor).
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('compliance')
  if (!auth.ok) return auth.response

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = IncidentCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid incident', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db.from('incidents').insert({ scope: v.data.scope, data_types: v.data.data_types ?? null, affected_count: v.data.affected_count ?? null, status: 'open', discovered_at: new Date().toISOString() }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'incident.step', entity: 'incident', entityId: data.id, diff: { step: 'opened', clock_started: true } })
    return NextResponse.json({ incident: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole('compliance')
  if (!auth.ok) return auth.response
  const parsed = await readJson<{ id?: string; status?: string }>(req)
  if ('error' in parsed) return parsed.error
  const { id, status } = parsed.data
  if (!id || !status || !['open', 'assessing', 'notifying', 'closed'].includes(status)) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { error } = await db.from('incidents').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'incident.step', entity: 'incident', entityId: id, diff: { step: status } })
    return NextResponse.json({ ok: true, status })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
