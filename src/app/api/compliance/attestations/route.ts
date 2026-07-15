import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { AttestationSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const auth = await requireApiRole('compliance')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data, error } = await db
      .from('attestations')
      .select('*')
      .order('created_at', { ascending: false })
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
  const v = AttestationSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('attestations')
      .insert({
        title: v.data.title,
        body: v.data.body,
        period: v.data.period ?? null,
        required_roles: v.data.required_roles,
        due_at: v.data.due_at ?? null,
        status: 'open',
        created_by: actor,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'attestation', entityId: data.id, diff: { title: data.title } })
    return NextResponse.json({ row: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
