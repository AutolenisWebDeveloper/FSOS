import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { writeAudit, AUDIT_ACTIONS } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/audit/log — session-authenticated audit writer for client-initiated
// events the archetypes require to be logged (exports, sensitive views). Only the
// bounded audit taxonomy is accepted; the append-only guarantee lives in the DB.
const Schema = z.object({
  action: z.enum(AUDIT_ACTIONS),
  entity: z.string().trim().min(1).max(80),
  entityId: z.string().trim().max(80).optional().nullable(),
  diff: z.record(z.unknown()).optional().nullable(),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = Schema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid audit event' }, { status: 400 })
  const res = await writeAudit({
    actor: actorOf(auth.session),
    action: v.data.action,
    entity: v.data.entity,
    entityId: v.data.entityId ?? null,
    diff: v.data.diff ?? null,
  })
  return NextResponse.json({ ok: res.ok })
}
