import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { CaseRequirementSchema, RequirementPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Add a requirement to a case (checklist / carrier / manual). Each outstanding
// requirement is actionable and can link to a document request (WF-1 step 7).
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CaseRequirementSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid requirement', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db.from('case_requirements').insert({ case_id: params.id, requirement: v.data.requirement, source: v.data.source, status: 'outstanding' }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Requirements outstanding → set the case status accordingly.
    await db.from('cases').update({ status: 'requirements_outstanding', updated_at: new Date().toISOString() }).eq('id', params.id).eq('status', 'underwriting')
    await writeAudit({ actor, action: 'entity.created', entity: 'case_requirement', entityId: data.id, diff: { case_id: params.id, requirement: v.data.requirement } })
    return NextResponse.json({ requirement: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Resolve/waive a requirement. Body: { requirement_id, status }.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<{ requirement_id?: string }>(req)
  if ('error' in parsed) return parsed.error
  const reqId = parsed.data.requirement_id
  const v = RequirementPatchSchema.safeParse(parsed.data)
  if (!reqId || !v.success) return NextResponse.json({ error: 'Invalid update', details: v.success ? undefined : v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { error } = await db.from('case_requirements').update({ status: v.data.status, updated_at: new Date().toISOString() }).eq('id', reqId).eq('case_id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'entity.updated', entity: 'case_requirement', entityId: reqId, diff: { status: v.data.status } })

    // If no outstanding requirements remain, move the case back to underwriting.
    const { data: remaining } = await db.from('case_requirements').select('id').eq('case_id', params.id).eq('status', 'outstanding').limit(1)
    if (!remaining || remaining.length === 0) {
      await db.from('cases').update({ status: 'underwriting', updated_at: new Date().toISOString() }).eq('id', params.id).eq('status', 'requirements_outstanding')
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
