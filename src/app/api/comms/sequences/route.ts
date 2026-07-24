import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { SequenceCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-13 Comms — sequences. A sequence is a green-zone education/invitation drip.
// It never bypasses the send gate: every enrolled send still passes the 7-step
// comms dispatcher (consent, quiet-hours, DNC, approved template, no recommendation,
// not securities-flagged). New sequences start as 'draft'.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('comm_sequences')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) return dbErrorResponse('comms/sequences', error)
    return NextResponse.json({ sequences: data ?? [] })
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
  const v = SequenceCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid sequence', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('comm_sequences')
      .insert({
        name: v.data.name,
        description: v.data.description ?? null,
        channel: v.data.channel,
        category: v.data.category ?? null,
        purpose: v.data.purpose ?? null, // Slice 7 (§9/§10) — default drip purpose.
        steps: v.data.steps,
        status: 'draft',
        requires_optout: true,
        created_by: actor,
      })
      .select('*')
      .single()
    if (error || !data) return dbErrorResponse('comms/sequences', error)
    await writeAudit({ actor, action: 'entity.created', entity: 'comm_sequence', entityId: data.id, diff: { name: data.name, channel: data.channel } })
    return NextResponse.json({ sequence: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create sequence' }, { status: 500 })
  }
}
