import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { TemplateCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { containsRecommendationLanguage } from '@/lib/compliance/guardrail'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-12 Templates. New templates start as draft. The editor blocks recommendation
// language and requires disclosure/opt-out tokens. Only approved templates are
// sendable (enforced at send time by the gate).
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('comm_templates').select('*').is('archived_at', null).order('updated_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ templates: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = TemplateCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid template', details: v.error.flatten() }, { status: 400 })

  // The editor blocks individualized recommendation language before it can even be saved.
  if (containsRecommendationLanguage(v.data.body)) {
    return NextResponse.json({ error: 'Template contains individualized recommendation / call-to-action language. Education/invitation only.', reason: 'recommendation' }, { status: 422 })
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('comm_templates')
      .insert({ name: v.data.name, channel: v.data.channel, category: v.data.category, body: v.data.body, approval_status: 'draft', version: 1, updated_by: actor })
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'comm_template', entityId: data.id, diff: { name: data.name, channel: data.channel, category: data.category } })
    return NextResponse.json({ template: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
