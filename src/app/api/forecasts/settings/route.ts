import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ForecastSettingsSchema } from '@/lib/validation/schemas'
import { normalizeProbabilities, DEFAULT_STAGE_PROBABILITIES } from '@/lib/analytics/forecast'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Advanced forecasting — the stage close-probability ASSUMPTIONS (guardrail §2.3).
// These are editable config defaults flagged is_assumption; every surface that
// shows them renders the "config default — verify" badge. Never invented Farmers data.
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('forecast_settings')
      .select('id, probabilities, horizon_months, is_assumption, updated_by, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      settings: data ?? {
        probabilities: DEFAULT_STAGE_PROBABILITIES,
        horizon_months: 3,
        is_assumption: true,
      },
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ForecastSettingsSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const probabilities = normalizeProbabilities(v.data.probabilities)

    // Read the current row (before-image for the config-change audit).
    const { data: current } = await db
      .from('forecast_settings')
      .select('id, probabilities, horizon_months')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const now = new Date().toISOString()
    let saved
    if (current?.id) {
      const { data, error } = await db
        .from('forecast_settings')
        .update({ probabilities, horizon_months: v.data.horizon_months, is_assumption: true, updated_by: actor, updated_at: now })
        .eq('id', current.id)
        .select('id, probabilities, horizon_months, is_assumption, updated_by, updated_at')
        .single()
      if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
      saved = data
    } else {
      const { data, error } = await db
        .from('forecast_settings')
        .insert({ probabilities, horizon_months: v.data.horizon_months, is_assumption: true, updated_by: actor })
        .select('id, probabilities, horizon_months, is_assumption, updated_by, updated_at')
        .single()
      if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
      saved = data
    }

    await writeAudit({
      actor,
      action: 'config.changed',
      entity: 'forecast_settings',
      entityId: saved.id,
      diff: {
        before: current ? { probabilities: current.probabilities, horizon_months: current.horizon_months } : null,
        after: { probabilities, horizon_months: v.data.horizon_months },
      },
    })
    return NextResponse.json({ settings: saved })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
