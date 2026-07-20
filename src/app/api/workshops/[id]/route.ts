import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkshopPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { evaluateWorkshopPublish, publishBlockMessage } from '@/lib/workshops/logic'
import { syncPresenters, gatherPublishFacts, recordMaterial } from '@/lib/workshops/server'

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
    if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
    if (!current) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    const { presenter_ids, hero_image_ref, ...rest } = v.data

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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

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
