import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PatchSchema = z
  .object({
    completed: z.boolean().optional(),
    due_at: z.string().datetime({ offset: true }).nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No changes')

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  try {
    const update: Record<string, unknown> = { ...v.data, updated_at: new Date().toISOString() }
    const { data, error } = await getDb()
      .from('work_tasks')
      .update(update)
      .eq('id', params.id)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.updated',
      entity: 'task',
      entityId: params.id,
      diff: v.data as Record<string, unknown>,
    })
    return NextResponse.json({ task: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
