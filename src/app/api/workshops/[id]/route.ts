import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkshopPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { evaluateWorkshopPublish, publishBlockMessage } from '@/lib/workshops/logic'
import { syncPresenters, gatherPublishFacts, recordMaterial, cancelWorkshopZoomMeetings } from '@/lib/workshops/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH /api/workshops/[id] — update details, attach presenters, or change status.
// Publishing is HARD-GATED (spec §8): status -> 'published' is blocked unless the
// workshop references an approved compliance approval AND an approved (non-placeholder)
// disclosure config. Defense in depth with the DB trigger in migration 038. There is no
// force-publish path. Roles: fsa, licensed_staff, admin, super_admin.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WorkshopPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()

    // Load current state (needed for the publish gate + effective values).
    const { data: current, error: loadErr } = await db
      .from('workshops')
      .select('workshop_id, status, compliance_approval_ref, disclosure_config_id')
      .eq('workshop_id', params.id)
      .maybeSingle()
    if (loadErr) return dbErrorResponse('workshops/[id]', loadErr)
    if (!current) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    const { presenter_ids, hero_image_ref, ...rest } = v.data

    // WS-047 (approval-gate integrity, D-5): 'compliance_approved' is minted ONLY by the
    // /approve route, which records the approver + snapshot (FINRA 2210). A bare PATCH
    // status flip would fabricate compliance standing with no approval record.
    if (rest.status === 'compliance_approved') {
      return NextResponse.json(
        { error: 'Compliance approval is recorded through the approval workflow, not a status change.' },
        { status: 422 },
      )
    }

    // Presenter attach/detach recomputes the securities firewall flag.
    if (presenter_ids) {
      await syncPresenters(db, params.id, presenter_ids)
    }
    if (hero_image_ref) {
      await recordMaterial(db, { workshopId: params.id, kind: 'hero_image', storageRef: hero_image_ref })
    }

    // Publish hard-gate. Evaluate against the values that WILL be set.
    if (rest.status === 'published') {
      const effective = {
        compliance_approval_ref: current.compliance_approval_ref,
        disclosure_config_id: rest.disclosure_config_id ?? current.disclosure_config_id,
      }
      const facts = await gatherPublishFacts(db, effective)
      const decision = evaluateWorkshopPublish({ nextStatus: 'published', ...facts })
      if (!decision.canPublish) {
        return NextResponse.json(
          { error: publishBlockMessage(decision.reasons), reasons: decision.reasons },
          { status: 422 },
        )
      }
    }

    const update: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() }
    if (hero_image_ref) update.hero_image_ref = hero_image_ref

    const { data, error } = await db
      .from('workshops')
      .update(update)
      .eq('workshop_id', params.id)
      .select('workshop_id, status')
    if (error) return dbErrorResponse('workshops/[id]', error)
    if (!data || data.length === 0) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    // Cancel → delete the session Zoom meetings so no stale join links survive. Only on the
    // transition INTO 'cancelled' (idempotent: re-cancelling a cancelled workshop is a no-op
    // since the meetings/columns are already cleared). Best-effort + gated: never blocks the
    // status change; a delete failure is audited for a manual sweep.
    if (rest.status === 'cancelled' && current.status !== 'cancelled') {
      try {
        const z = await cancelWorkshopZoomMeetings(db, params.id)
        if (z.failed > 0) {
          await writeAudit({ actor, action: 'config.changed', entity: 'workshop', entityId: params.id, diff: { zoom_delete_failed: z.failed, zoom_deleted: z.deleted } })
        }
      } catch (zerr) {
        console.error('[workshop] zoom meeting cancel cleanup (non-fatal):', zerr)
      }
    }

    await writeAudit({
      actor,
      action: rest.status ? 'stage.changed' : 'entity.updated',
      entity: 'workshop',
      entityId: params.id,
      diff: v.data,
    })
    return NextResponse.json({ ok: true, status: data[0].status })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update workshop' }, { status: 500 })
  }
}
