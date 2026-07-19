import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — the outreach queue (filterable by agent/status). Read-only surface for the
// FSA to review what the workforce is about to do / has done.
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const url = new URL(req.url)
  const agent = url.searchParams.get('agent')
  const status = url.searchParams.get('status')
  try {
    const db = getDb()
    let q = db
      .from('outreach_queue')
      .select('id, queue_date, agent_key, source, entity_type, entity_id, household_id, channel, priority, reason, status, block_reason, outcome, run_id, message_id, created_at')
      .order('priority', { ascending: false })
      .limit(500)
    if (agent) q = q.eq('agent_key', agent)
    if (status) q = q.eq('status', status)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ items: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// PATCH — human override on a queue item: hold/skip a pending item (so the workforce
// won't contact that target today), or record a closed-loop outcome (responded/
// booked/converted). Cannot flip an item to 'sent' — only the gate can do that.
const PatchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['held', 'skipped', 'queued']).optional(),
  outcome: z.enum(['responded', 'booked', 'converted', 'none']).optional(),
})

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  if (!v.data.status && !v.data.outcome) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  try {
    const db = getDb()
    const before = await db.from('outreach_queue').select('status, outcome').eq('id', v.data.id).maybeSingle()
    if (before.error) return NextResponse.json({ error: before.error.message }, { status: 500 })
    if (!before.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (v.data.status) {
      // Only pending items may be held/skipped; never override a sent/blocked record.
      if (!['queued', 'held', 'skipped'].includes(before.data.status)) {
        return NextResponse.json({ error: `Cannot change status from '${before.data.status}'` }, { status: 409 })
      }
      patch.status = v.data.status
    }
    if (v.data.outcome) patch.outcome = v.data.outcome

    const { data, error } = await db.from('outreach_queue').update(patch).eq('id', v.data.id).select('id, status, outcome').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.updated',
      entity: 'outreach_queue',
      entityId: v.data.id,
      diff: { before: before.data, after: patch },
    })
    return NextResponse.json({ item: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
