import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET  /api/app/notifications        — the current user's notifications
// PATCH /api/app/notifications       — mark one ({id}) or all ({all:true}) read
//
// Ports the legacy top-bar notification bell (which was a hard-coded toast) onto
// the real `notifications` table. Strictly user-scoped: every query is filtered
// to the authenticated user's id, so a user only ever sees/updates their own.
const patchSchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({ all: z.literal(true) }),
])

export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const db = getDb()
  const { data, error } = await db
    .from('notifications')
    .select('id, kind, title, body, link, read_at, created_at')
    .eq('user_id', auth.session.userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const notifications = data ?? []
  const unread = notifications.filter((n) => !n.read_at).length
  return NextResponse.json({ notifications, unread })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }
  const db = getDb()
  const now = new Date().toISOString()

  let query = db.from('notifications').update({ read_at: now }).eq('user_id', auth.session.userId).is('read_at', null)
  if ('id' in parsed.data) query = query.eq('id', parsed.data.id)

  const { data, error } = await query.select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const count = data?.length ?? 0

  if (count > 0) {
    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.updated',
      entity: 'notification',
      entityId: 'id' in parsed.data ? parsed.data.id : null,
      diff: { read: count },
    })
  }
  return NextResponse.json({ updated: count })
}
