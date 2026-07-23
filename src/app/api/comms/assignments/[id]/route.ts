import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Resolve or dismiss an assignment-review item (Slice 1, §6). Resolution is the
// authorized human decision for a record whose communication ownership could not be
// confidently resolved. The conflict + decision are preserved in the audit trail.
const BodySchema = z.object({
  action: z.enum(['resolve', 'dismiss']),
  resolution: z.string().trim().min(1).max(2000).optional(),
})

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  // Ownership resolution is a back-office authorization decision (§21 roles).
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<unknown>(req)
  if ('error' in parsed) return parsed.error
  const body = BodySchema.safeParse(parsed.data)
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid request', details: body.error.flatten() }, { status: 400 })
  }

  try {
    const db = getDb()
    const { data: existing } = await db
      .from('comm_assignment_reviews')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.status !== 'open') {
      return NextResponse.json({ error: `Review is already ${existing.status}.` }, { status: 409 })
    }

    const status = body.data.action === 'resolve' ? 'resolved' : 'dismissed'
    const { error } = await db
      .from('comm_assignment_reviews')
      .update({
        status,
        resolution: body.data.resolution ?? null,
        resolved_by: actorOf(auth.session),
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'open') // optimistic guard against a concurrent resolve
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.updated',
      entity: 'comm_assignment_review',
      entityId: id,
      diff: { status, resolution: body.data.resolution ?? null },
    })
    return NextResponse.json({ ok: true, status })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
