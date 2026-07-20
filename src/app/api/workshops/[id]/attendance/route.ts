import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { AttendanceReconcileSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { reconcileAttendance } from '@/lib/workshops/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/workshops/[id]/attendance — bulk/typed attendance reconcile (spec §5). For
// virtual + hybrid (interim, until the P3 Zoom webhook) and for roster corrections: mark
// attended/no_show/left_early per registrant. Idempotent — an entry whose status already
// matches is skipped (no write, no audit churn), so a retry never double-counts. Every
// write is capture_method='manual'; the same workshop_attendance table a future Zoom
// webhook will write with capture_method='webhook'. Staff rbac. Audited.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = AttendanceReconcileSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid attendance', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const { data: w } = await db.from('workshops').select('workshop_id').eq('workshop_id', params.id).maybeSingle()
    if (!w) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    const result = await reconcileAttendance(db, params.id, v.data.entries)

    if (result.written > 0) {
      await writeAudit({
        actor,
        action: 'entity.updated',
        entity: 'workshop_attendance',
        entityId: params.id,
        diff: { via: 'reconcile', written: result.written, skipped: result.skipped },
      })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Attendance reconcile failed' }, { status: 500 })
  }
}
