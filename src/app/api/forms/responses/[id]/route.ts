import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { FormAttachSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH /api/forms/responses/[id] — attach a submitted client-form response to a
// household (docs/legacy-port.md §2.3: "a submitted form lands on the right
// household; consent recorded"). Materializes the captured consent channels into
// real `consents` rows keyed to the household. Roles: fsa, licensed_staff, admin, ops.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'ops', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = FormAttachSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid attach', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)

  try {
    const db = getDb()

    const { data: resp, error: rErr } = await db
      .from('form_responses')
      .select('id, status, consent_channels, submitter_email, submitter_phone, household_id')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 })
    if (!resp) return NextResponse.json({ error: 'Response not found' }, { status: 404 })

    const { data: hh, error: hErr } = await db
      .from('households')
      .select('id, primary_name')
      .eq('id', v.data.household_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 })
    if (!hh) return NextResponse.json({ error: 'Household not found' }, { status: 404 })

    const nowIso = new Date().toISOString()
    const { error: uErr } = await db
      .from('form_responses')
      .update({ household_id: hh.id, status: 'attached', attached_at: nowIso, updated_at: nowIso })
      .eq('id', resp.id)
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

    // Materialize captured consent into real consents rows on the household.
    const channels = Array.isArray(resp.consent_channels) ? (resp.consent_channels as string[]) : []
    for (const channel of channels) {
      await db.from('consents').insert({
        household_id: hh.id,
        channel,
        status: 'granted',
        source: 'client_form',
        disclosure: 'Consent captured on public client intake form.',
      })
    }

    await db.from('activities').insert({
      entity_type: 'household',
      entity_id: hh.id,
      kind: 'form_attached',
      note: `Client form response attached to ${hh.primary_name}.`,
      actor,
    })

    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'form_response',
      entityId: resp.id,
      diff: { attached_to: hh.id },
    })
    if (channels.length > 0) {
      await writeAudit({
        actor,
        action: 'consent.captured',
        entity: 'household',
        entityId: hh.id,
        diff: { source: 'client_form', channels },
      })
    }

    return NextResponse.json({ ok: true, household_id: hh.id, household_name: hh.primary_name })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to attach response' }, { status: 500 })
  }
}

// DELETE /api/forms/responses/[id] — soft-archive a response (spam / withdrawn).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'ops', 'super_admin'])
  if (denied) return denied

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const nowIso = new Date().toISOString()
    const { data, error } = await db
      .from('form_responses')
      .update({ status: 'archived', deleted_at: nowIso, updated_at: nowIso })
      .eq('id', params.id)
      .is('deleted_at', null)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) return NextResponse.json({ error: 'Response not found' }, { status: 404 })
    await writeAudit({ actor, action: 'entity.deleted', entity: 'form_response', entityId: params.id, diff: { soft: true } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to archive response' }, { status: 500 })
  }
}
