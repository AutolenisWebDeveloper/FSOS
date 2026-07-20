import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, readJson } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { NigoIssuePatchSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — the issue-resolution workspace record (mig 037).
// PATCH { status?, severity?, assigned_to?, human_reviewed?, reviewer_notes?,
//         resolution?, response_text? }
// Human-in-the-loop control: a licensed human moves an issue through its status
// machine and records the review/resolution. The AI drafts; the human confirms.
// Every change is audited (stage.changed).

const WRITE_ROLES = ['fsa', 'licensed_staff', 'super_admin', 'compliance', 'supervisor'] as const

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req, 40_000)
  if ('error' in parsed) return parsed.error
  const v = NigoIssuePatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })
  const d = v.data
  if (Object.keys(d).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    const { data: existing } = await db.from('nigo_issues').select('id, status').eq('id', params.id).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Issue not found' }, { status: 404 })

    const patch: Record<string, unknown> = { ...d }
    // Stamp resolved_at when the issue reaches a terminal resolved/closed state.
    if (d.status && ['resolved', 'closed'].includes(d.status)) patch.resolved_at = new Date().toISOString()

    const { data: updated, error } = await db
      .from('nigo_issues')
      .update(patch)
      .eq('id', params.id)
      .select(
        'id, case_id, seq, status, severity, assigned_to, human_reviewed, reviewer_notes, resolution, response_text, validity, authority_type',
      )
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({
      actor,
      action: 'stage.changed',
      entity: 'nigo_issue',
      entityId: params.id,
      diff: { from: existing.status, to: d.status ?? existing.status, human_reviewed: d.human_reviewed },
    })

    return NextResponse.json({ issue: updated })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
