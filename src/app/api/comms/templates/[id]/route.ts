import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { TemplatePatchSchema, TemplateApprovalSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { containsRecommendationLanguage } from '@/lib/compliance/guardrail'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH — edit a template. Editing creates a NEW version (old body retained in a
// prior version row is out of scope for P1; we bump the version + reset approval to
// draft so an edited-after-approval template cannot send until re-approved).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = TemplatePatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })
  if (v.data.body && containsRecommendationLanguage(v.data.body)) {
    return NextResponse.json({ error: 'Template contains recommendation language. Education/invitation only.', reason: 'recommendation' }, { status: 422 })
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: t } = await db.from('comm_templates').select('version, approval_status').eq('id', params.id).maybeSingle()
    if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const update: Record<string, unknown> = { ...v.data, updated_by: actor, updated_at: new Date().toISOString() }
    // Any edit invalidates a prior approval: bump version + back to draft (old retained).
    update.version = (t.version ?? 1) + 1
    update.approval_status = 'draft'
    update.approved_at = null
    update.approved_by = null

    const { error } = await db.from('comm_templates').update(update).eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'entity.updated', entity: 'comm_template', entityId: params.id, diff: { version: update.version, reset_to_draft: true } })
    return NextResponse.json({ ok: true, version: update.version })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST — submit for approval (fsa) OR approve/reject (compliance/supervisor/super ONLY).
// Approval authority is limited to compliance/supervisor/super — an FSA cannot
// approve their own template. Only approved templates are usable by any campaign/agent.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa') // base auth; role check below per action
  if (!auth.ok) {
    // compliance/supervisor users aren't in the fsa portal — fall back to compliance portal auth.
    const compAuth = await requireApiRole('compliance')
    if (!compAuth.ok) return compAuth.response
    return handleApproval(req, params.id, compAuth.session.userId, compAuth.session.roles)
  }
  return handleApproval(req, params.id, auth.session.userId, auth.session.roles)
}

async function handleApproval(req: NextRequest, id: string, userId: string, roles: string[]) {
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = TemplateApprovalSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid action', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = userId

    if (v.data.action === 'submit') {
      // Any authoring role may submit their draft for review.
      if (!roles.some((r) => ['fsa', 'licensed_staff', 'super_admin', 'compliance', 'supervisor'].includes(r))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { error } = await db.from('comm_templates').update({ approval_status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', id).eq('approval_status', 'draft')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await writeAudit({ actor, action: 'approval.decided', entity: 'comm_template', entityId: id, diff: { action: 'submitted' } })
      return NextResponse.json({ ok: true, status: 'submitted' })
    }

    // approve / reject — LIMITED to compliance / supervisor / super_admin.
    if (!roles.some((r) => ['compliance', 'supervisor', 'super_admin'].includes(r))) {
      return NextResponse.json({ error: 'Only compliance, supervisor, or super admin may approve templates.', reason: 'insufficient_permission' }, { status: 403 })
    }
    const status = v.data.action === 'approve' ? 'approved' : 'draft'
    const patch: Record<string, unknown> = { approval_status: status }
    if (v.data.action === 'approve') { patch.approved_at = new Date().toISOString(); patch.approved_by = actor }
    const { error } = await db.from('comm_templates').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'approval.decided', entity: 'comm_template', entityId: id, diff: { action: v.data.action, status } })
    return NextResponse.json({ ok: true, status })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
