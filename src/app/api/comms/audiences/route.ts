import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { AudienceCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-13 Comms — audience builder. An audience is only a segment DEFINITION; the
// actual dispatch re-checks the full comms gate per recipient at send time.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('comm_audiences')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ audiences: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Rough size estimate for the chosen base. This is an approximate segment count
// (the real, gated recipient list is resolved at dispatch time), so it is stored
// only as guidance.
async function estimateSize(base: 'households' | 'agencies' | 'policies'): Promise<number> {
  const db = getDb()
  if (base === 'agencies') {
    const { count } = await db.from('agency_partnerships').select('id', { count: 'exact', head: true })
    return count ?? 0
  }
  if (base === 'policies') {
    const { count } = await db.from('household_policies').select('id', { count: 'exact', head: true }).is('deleted_at', null)
    return count ?? 0
  }
  const { count } = await db.from('households').select('id', { count: 'exact', head: true }).is('deleted_at', null)
  return count ?? 0
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = AudienceCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid audience', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const estimated = await estimateSize(v.data.definition.base)
    const { data, error } = await db
      .from('comm_audiences')
      .insert({
        name: v.data.name,
        description: v.data.description ?? null,
        definition: v.data.definition,
        estimated_size: estimated,
        created_by: actor,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'comm_audience', entityId: data.id, diff: { name: data.name, base: v.data.definition.base } })
    return NextResponse.json({ audience: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create audience' }, { status: 500 })
  }
}
