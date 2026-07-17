import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { OpraStatusSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Update an OPRA case's status (one-click toggles: contacted / appointment /
// review / transferred). Manual FSA actions — no automated client send here — so
// the securities firewall does not block them; is_security records are surfaced
// read-only in the UI. Timestamps are stamped when a flag flips.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = OpraStatusSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    const { data: existing } = await db
      .from('opra_transfers')
      .select('id, status, contacted, appt_scheduled, review_complete, transferred')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'OPRA case not found' }, { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {}
    const d = v.data
    if (d.contacted !== undefined) {
      updates.contacted = d.contacted
      updates.contacted_at = d.contacted ? new Date().toISOString() : null
    }
    if (d.appt_scheduled !== undefined) updates.appt_scheduled = d.appt_scheduled
    if (d.appt_date !== undefined) updates.appt_date = d.appt_date
    if (d.review_complete !== undefined) updates.review_complete = d.review_complete
    if (d.review_date !== undefined) updates.review_date = d.review_date
    if (d.transferred !== undefined) {
      updates.transferred = d.transferred
      if (d.transferred) updates.transferred_date = new Date().toISOString().slice(0, 10)
    }
    if (d.notes !== undefined) updates.notes = d.notes

    // Keep the lifecycle status coherent with the flags unless one is set explicitly.
    if (d.status !== undefined) {
      updates.status = d.status
    } else {
      const merged = { ...existing, ...updates }
      updates.status = merged.transferred
        ? 'transferred'
        : merged.review_complete
          ? 'reviewed'
          : merged.appt_scheduled
            ? 'scheduled'
            : merged.contacted
              ? 'contacted'
              : 'identified'
    }

    const { data: row, error } = await db
      .from('opra_transfers')
      .update(updates)
      .eq('id', params.id)
      .select('id, status, contacted, appt_scheduled, review_complete, transferred')
      .maybeSingle()
    if (error || !row) return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })

    await writeAudit({ actor, action: 'entity.updated', entity: 'opra_transfer', entityId: params.id, diff: updates })
    if (d.status && d.status !== existing.status) {
      await writeAudit({ actor, action: 'stage.changed', entity: 'opra_transfer', entityId: params.id, diff: { from: existing.status, to: d.status } })
    }

    return NextResponse.json({ ok: true, case: row })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update OPRA case' }, { status: 500 })
  }
}
