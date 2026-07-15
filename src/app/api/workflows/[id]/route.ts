import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkflowPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET one workflow + its recent runs · PATCH enable/disable + archive.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data, error } = await db.from('automation_workflows').select('*').eq('id', params.id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: runs, error: runsError } = await db
      .from('automation_runs')
      .select('*')
      .eq('workflow_id', params.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (runsError) return NextResponse.json({ error: runsError.message }, { status: 500 })

    return NextResponse.json({ workflow: data, runs: runs ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WorkflowPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const update: Record<string, unknown> = { updated_by: actor, updated_at: new Date().toISOString() }
    if (typeof v.data.enabled === 'boolean') update.enabled = v.data.enabled
    if (v.data.archived === true) update.archived_at = new Date().toISOString()
    if (v.data.archived === false) update.archived_at = null

    const { data, error } = await db
      .from('automation_workflows')
      .update(update)
      .eq('id', params.id)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await writeAudit({
      actor,
      action: 'config.changed',
      entity: 'automation_workflow',
      entityId: params.id,
      diff: { enabled: data.enabled, archived_at: data.archived_at },
    })
    return NextResponse.json({ workflow: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update workflow' }, { status: 500 })
  }
}
