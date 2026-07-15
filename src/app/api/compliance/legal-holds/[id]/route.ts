import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { LegalHoldReleaseSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// IMPORTANT: a legal hold SUSPENDS retention-based deletion for its scope.
// Releasing it lifts that preservation override — it does NOT delete anything.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('compliance')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['compliance', 'supervisor', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = LegalHoldReleaseSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('legal_holds')
      .update({ status: 'released', released_by: actor, released_at: new Date().toISOString() })
      .eq('id', params.id)
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
    await writeAudit({ actor, action: 'config.changed', entity: 'legal_hold', entityId: params.id, diff: { status: 'released' } })
    return NextResponse.json({ row: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
