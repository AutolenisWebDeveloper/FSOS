import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'
import { TemplateBulkSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { canBulkTemplateAction, bulkTemplatePlan } from '@/lib/comms/template-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST — bulk template administration over a selection: approve / unapprove / delete.
// Mirrors the single-template route's auth (fsa portal OR compliance portal) and its
// separation of authority: only compliance/supervisor/super_admin may approve or
// unapprove (an author cannot approve their own work). Delete is a soft-delete
// (archive) — the send gate treats archived_at as unsendable and FK refs are
// ON DELETE SET NULL, so message/campaign history is preserved.
export async function POST(req: NextRequest) {
  // Base auth: FSA portal first, else the compliance portal (compliance/supervisor
  // users don't sit in the fsa portal) — same fallback the single route uses.
  let session
  const fsaAuth = await requireApiRole('fsa')
  if (fsaAuth.ok) {
    session = fsaAuth.session
  } else {
    const compAuth = await requireApiRole('compliance')
    if (!compAuth.ok) return compAuth.response
    session = compAuth.session
  }

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = TemplateBulkSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  const { action, ids } = v.data
  const perm = canBulkTemplateAction(action, session.roles)
  if (!perm.allowed) {
    return NextResponse.json(
      {
        error:
          action === 'delete'
            ? 'You do not have permission to delete templates.'
            : 'Only compliance, supervisor, or super admin may approve or unapprove templates.',
        reason: perm.reason,
      },
      { status: 403 },
    )
  }

  try {
    const db = getDb()
    const actor = session.userId
    const now = new Date().toISOString()
    const plan = bulkTemplatePlan(action, now, actor)

    // De-duplicate ids so `requested` reflects distinct targets.
    const uniqueIds = Array.from(new Set(ids))

    let q = db.from('comm_templates').update(plan.patch).in('id', uniqueIds)
    // Approve/unapprove never touch archived rows; delete only archives live rows.
    q = q.is('archived_at', null)
    if (plan.requireStatus) q = q.eq('approval_status', plan.requireStatus)
    if (plan.excludeApproved) q = q.neq('approval_status', 'approved')

    const { data: rows, error } = await q.select('id')
    if (error) return dbErrorResponse('comms/templates/bulk', error)

    const affected = rows ?? []
    // One audit row per template actually changed — attributable + granular (§13.9).
    await Promise.all(
      affected.map((r) =>
        writeAudit({
          actor,
          action: plan.audit,
          entity: 'comm_template',
          entityId: r.id,
          diff: { action, bulk: true },
        }),
      ),
    )

    return NextResponse.json({ ok: true, action, affected: affected.length, requested: uniqueIds.length })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
