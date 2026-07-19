import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { DashboardCreateSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-01 Custom dashboards (P3). A dashboard is a named, ordered set of widgets;
// every widget renders from a DB-derived metric (lib/analytics/metrics.ts) so a
// saved dashboard never drifts from the data. Internal read surface only.
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('dashboards')
      .select('id, name, description, layout, visibility, created_by, created_at, updated_at')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ dashboards: data ?? [] })
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
  const v = DashboardCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid dashboard', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('dashboards')
      .insert({
        name: v.data.name,
        description: v.data.description ?? null,
        visibility: v.data.visibility,
        layout: v.data.layout,
        created_by: actor,
        updated_by: actor,
      })
      .select('id, name, description, layout, visibility, created_at, updated_at')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'dashboard',
      entityId: data.id,
      diff: { name: data.name, widgets: v.data.layout.length },
    })
    return NextResponse.json({ dashboard: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create dashboard' }, { status: 500 })
  }
}
