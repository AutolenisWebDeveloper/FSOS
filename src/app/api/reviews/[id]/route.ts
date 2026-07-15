import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { ReviewStageSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET one review.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('reviews').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ review: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// PATCH stage — board drag / workspace advance. A review is never "done" without an
// outcome record, so advancing to completed routes the UI to /outcome (enforced there).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ReviewStageSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid stage', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: review } = await db.from('reviews').select('stage').eq('id', params.id).is('deleted_at', null).maybeSingle()
    if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const from = review.stage as string
    const { error } = await db.from('reviews').update({ stage: v.data.stage, updated_at: new Date().toISOString() }).eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({ actor, action: 'stage.changed', entity: 'review', entityId: params.id, diff: { from, to: v.data.stage } })
    return NextResponse.json({ ok: true, stage: v.data.stage })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
