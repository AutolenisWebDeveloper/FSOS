import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { OUTREACH_AGENTS } from '@/lib/ai/outreach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Super · AI workforce daily quotas. The daily_target/channel values are CONFIG
// DEFAULTS (is_assumption=true → "config default — verify" badge). This is the dial
// for "contact a targeted number of clients each day": the orchestrator never exceeds
// daily_target contacts per agent per day. Editing a target clears its assumption
// flag (the operator has now verified it).
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data, error } = await db
      .from('agent_daily_targets')
      .select('agent_key, daily_target, channel, enabled, is_assumption, note, updated_at')
      .order('agent_key')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ targets: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

const PutSchema = z.object({
  agent_key: z.enum(OUTREACH_AGENTS),
  daily_target: z.number().int().min(0).max(1000).optional(),
  channel: z.enum(['sms', 'email']).optional(),
  enabled: z.boolean().optional(),
})

export async function PUT(req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = PutSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const before = await db.from('agent_daily_targets').select('*').eq('agent_key', v.data.agent_key).maybeSingle()
    if (before.error) return NextResponse.json({ error: before.error.message }, { status: 500 })
    if (!before.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const patch: Record<string, unknown> = { is_assumption: false, updated_at: new Date().toISOString() }
    if (v.data.daily_target !== undefined) patch.daily_target = v.data.daily_target
    if (v.data.channel !== undefined) patch.channel = v.data.channel
    if (v.data.enabled !== undefined) patch.enabled = v.data.enabled

    const { data, error } = await db
      .from('agent_daily_targets')
      .update(patch)
      .eq('agent_key', v.data.agent_key)
      .select('agent_key, daily_target, channel, enabled, is_assumption, note, updated_at')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'config.changed',
      entity: 'agent_daily_targets',
      entityId: v.data.agent_key,
      diff: { before: before.data, after: patch },
    })
    return NextResponse.json({ target: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
