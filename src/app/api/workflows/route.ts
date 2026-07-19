import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkflowCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-14 Automation workflows. Workflows automate internal tasks + green-zone
// outreach; any comm-sending step still passes the comms dispatcher gate
// (consent / quiet-hours / DNC / securities). New workflows start disabled.
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('automation_workflows')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ workflows: data ?? [] })
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
  const v = WorkflowCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid workflow', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('automation_workflows')
      .insert({
        name: v.data.name,
        description: v.data.description ?? null,
        trigger_type: v.data.trigger_type,
        trigger_config: v.data.trigger_config,
        conditions: v.data.conditions,
        steps: v.data.steps,
        failure_policy: v.data.failure_policy,
        enabled: false,
        created_by: actor,
        updated_by: actor,
      })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'automation_workflow',
      entityId: data.id,
      diff: { name: data.name, trigger_type: data.trigger_type },
    })
    return NextResponse.json({ workflow: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
  }
}
