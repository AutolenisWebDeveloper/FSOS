import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { LegalHoldSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// A legal hold SUSPENDS retention-based deletion for its scope — it is a
// preservation override, never a delete. Listing is read-only.
export async function GET() {
  const auth = await requireApiRole('compliance')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data, error } = await db
      .from('legal_holds')
      .select('*')
      .order('placed_at', { ascending: false })
      .limit(200)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rows: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('compliance')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['compliance', 'supervisor', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = LegalHoldSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('legal_holds')
      .insert({
        name: v.data.name,
        matter_ref: v.data.matter_ref ?? null,
        reason: v.data.reason,
        scope: v.data.scope ?? null,
        status: 'active',
        placed_by: actor,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'legal_hold', entityId: data.id, diff: { name: data.name } })
    return NextResponse.json({ row: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
