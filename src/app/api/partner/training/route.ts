import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { TrainingCompleteSchema } from '@/lib/validation/schemas'
import { agencyIdsFor } from '@/lib/portal/scope'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// P-2 Partner training — record that the signed-in owner completed a module.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('partner')
  if (!auth.ok) return auth.response
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = TrainingCompleteSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const agencyIds = await agencyIdsFor(auth.session)
    const agencyId = agencyIds[0] ?? null
    const { error } = await db
      .from('partner_training_completions')
      .upsert(
        { training_id: v.data.training_id, agency_id: agencyId, user_id: actor },
        { onConflict: 'training_id,user_id' },
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'partner_training',
      entityId: v.data.training_id,
      diff: { completed: true },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
