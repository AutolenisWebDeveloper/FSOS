import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkshopApproveSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { PLACEHOLDER_MARKER } from '@/lib/workshops/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/workshops/[id]/approve — the FSA/owner is the approving principal and
// self-approves their own workshops (spec §8). Writes the hard-gate record
// (workshop_approvals) with a snapshot of the exact material versions + presenters +
// disclosure version, and captures the approver's name + CRD from the request (never
// hardcoded). On 'approved' it also blesses the referenced disclosure version
// (is_assumption -> false) and moves the workshop to 'compliance_approved' so it becomes
// publishable. It REFUSES to approve a disclosure whose body is still a placeholder
// (guardrail 3 — placeholder text can never reach a published page). The approval row is
// always written; there is no publish path that bypasses it. Roles: fsa, super_admin.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WorkshopApproveSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid approval', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const { data: workshop, error: wErr } = await db
      .from('workshops')
      .select('workshop_id, disclosure_config_id')
      .eq('workshop_id', params.id)
      .maybeSingle()
    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })
    if (!workshop) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    // ── Rejection: record it and send the workshop back to draft. ──
    if (v.data.decision === 'rejected') {
      const { data: appr, error: aErr } = await db
        .from('workshop_approvals')
        .insert({
          workshop_id: params.id,
          approver_name: v.data.approver_name,
          approver_crd: v.data.approver_crd ?? null,
          decision: 'rejected',
          notes: v.data.notes ?? null,
        })
        .select('id')
        .single()
      if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
      await db.from('workshops').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('workshop_id', params.id)
      await writeAudit({ actor, action: 'approval.decided', entity: 'workshop', entityId: params.id, diff: { decision: 'rejected', approval_id: appr.id } })
      return NextResponse.json({ ok: true, decision: 'rejected' })
    }

    // ── Approval: resolve + bless the disclosure version, then snapshot + gate-open. ──
    const disclosureId = v.data.disclosure_config_id ?? workshop.disclosure_config_id
    if (!disclosureId) {
      return NextResponse.json({ error: 'Select a disclosure version to approve this workshop under.' }, { status: 422 })
    }

    const { data: disclosure, error: dErr } = await db
      .from('workshop_disclosure_configs')
      .select('id, kind, version, body')
      .eq('id', disclosureId)
      .maybeSingle()
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
    if (!disclosure) return NextResponse.json({ error: 'Disclosure version not found' }, { status: 404 })

    // Optionally replace the disclosure body with the approved text supplied now.
    const effectiveBody = v.data.disclosure_body ?? disclosure.body
    if (effectiveBody.includes(PLACEHOLDER_MARKER)) {
      return NextResponse.json(
        { error: 'This disclosure is still placeholder text. Replace it with the approved language before approving.' },
        { status: 422 },
      )
    }

    // Bless the disclosure version (is_assumption -> false = verified/approved).
    await db
      .from('workshop_disclosure_configs')
      .update({
        body: effectiveBody,
        is_assumption: false,
        approved_by: v.data.approver_name,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', disclosureId)

    // Snapshot the exact approved bundle: materials + presenters + disclosure version.
    const { data: materials } = await db
      .from('workshop_materials')
      .select('id, kind, label, version, storage_ref')
      .eq('workshop_id', params.id)
    const { data: presenters } = await db
      .from('workshop_presenters')
      .select('presenter_id, display_order')
      .eq('workshop_id', params.id)

    const { data: appr, error: aErr } = await db
      .from('workshop_approvals')
      .insert({
        workshop_id: params.id,
        approver_name: v.data.approver_name,
        approver_crd: v.data.approver_crd ?? null,
        decision: 'approved',
        notes: v.data.notes ?? null,
        material_versions: {
          materials: materials ?? [],
          presenters: presenters ?? [],
          disclosure: { id: disclosure.id, kind: disclosure.kind, version: disclosure.version },
        },
      })
      .select('id')
      .single()
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

    // Open the gate: reference the approval + disclosure, move to compliance_approved.
    await db
      .from('workshops')
      .update({
        compliance_approval_ref: appr.id,
        disclosure_config_id: disclosureId,
        status: 'compliance_approved',
        updated_at: new Date().toISOString(),
      })
      .eq('workshop_id', params.id)

    await writeAudit({
      actor,
      action: 'approval.decided',
      entity: 'workshop',
      entityId: params.id,
      diff: { decision: 'approved', approval_id: appr.id, disclosure_config_id: disclosureId },
    })
    return NextResponse.json({ ok: true, decision: 'approved', approval_id: appr.id })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to record approval' }, { status: 500 })
  }
}
