import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { dispatchCampaign } from '@/lib/comms/campaign'
import { simulateCampaign } from '@/lib/comms/simulation'
import { simulationSatisfiesActivation } from '@/lib/comms/simulation-core'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('comm_campaigns').select('*').eq('id', params.id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ campaign: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST — activate + dispatch, or pause. Body: { action: 'activate' | 'pause' }.
// Activation runs the gate per recipient; empty audience blocks activation.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<{ action?: string }>(req)
  if ('error' in parsed) return parsed.error
  const action = parsed.data.action

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    if (action === 'pause') {
      await db.from('comm_campaigns').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', params.id)
      await writeAudit({ actor, action: 'entity.updated', entity: 'comm_campaign', entityId: params.id, diff: { status: 'paused' } })
      return NextResponse.json({ ok: true, status: 'paused' })
    }

    if (action === 'simulate') {
      // §14 — a SAFE dry-run: never calls a provider, writes no message. Persists the
      // result so activation can require a recent simulation pass.
      const report = await simulateCampaign(params.id)
      if ('error' in report) return NextResponse.json({ error: report.error }, { status: 404 })
      await db
        .from('comm_campaigns')
        .update({ simulated_at: report.simulatedAt, last_simulation: report.summary, updated_at: new Date().toISOString() })
        .eq('id', params.id)
      await writeAudit({ actor, action: 'ai.action', entity: 'comm_campaign', entityId: params.id, diff: { simulated: report.summary } })
      return NextResponse.json({ ok: true, simulation: report })
    }

    if (action === 'activate') {
      // §14 — a simulation/preview pass is REQUIRED before activation.
      const { data: c } = await db.from('comm_campaigns').select('simulated_at').eq('id', params.id).maybeSingle()
      const gate = simulationSatisfiesActivation(c?.simulated_at ?? null, new Date().toISOString())
      if (!gate.ok) return NextResponse.json({ error: gate.reason, reason: 'simulation_required' }, { status: 422 })
      await db.from('comm_campaigns').update({ status: 'active', activated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', params.id)
      await writeAudit({ actor, action: 'entity.updated', entity: 'comm_campaign', entityId: params.id, diff: { status: 'active' } })
      const result = await dispatchCampaign(params.id, actor)
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: 422 })
      if (result.audience === 0) {
        // Empty audience → activation is a no-op; report it (never a silent success).
        return NextResponse.json({ ok: true, status: 'active', dispatched: result, note: 'No eligible recipients.' })
      }
      return NextResponse.json({ ok: true, status: 'active', dispatched: result })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
