import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { AttestationAckSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Acknowledge an attestation: one response per user (unique attestation_id,user_id),
// so re-acknowledging upserts the same row rather than duplicating.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('compliance')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['compliance', 'supervisor', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = AttestationAckSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('attestation_responses')
      .upsert(
        {
          attestation_id: params.id,
          user_id: actor,
          acknowledged_at: new Date().toISOString(),
          response: v.data.response ?? null,
        },
        { onConflict: 'attestation_id,user_id' },
      )
      .select('*')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Acknowledge failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.updated', entity: 'attestation', entityId: params.id, diff: { ack: true } })
    return NextResponse.json({ row: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
