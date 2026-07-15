import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { CompliancePolicyActionSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Publish makes a policy effective now; retire withdraws it. Both are config
// changes on the append-only audit trail, never destructive deletes.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('compliance')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['compliance', 'supervisor', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CompliancePolicyActionSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const patch =
      v.data.action === 'publish'
        ? { status: 'published', effective_at: new Date().toISOString(), published_by: actor }
        : { status: 'retired' }
    const { data, error } = await db
      .from('compliance_policies')
      .update(patch)
      .eq('id', params.id)
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
    await writeAudit({ actor, action: 'config.changed', entity: 'compliance_policy', entityId: params.id, diff: { action: v.data.action } })
    return NextResponse.json({ row: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
