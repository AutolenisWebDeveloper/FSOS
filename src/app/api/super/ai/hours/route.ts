import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Super · Hours of operation for automated outreach. The dial for "don't text people
// all day and all night." Governs EVERY automated SMS/email (workforce, campaigns,
// drips, AI replies) via the send gate's business_hours step + the orchestrator
// pre-check. It can only TIGHTEN the legal recipient-local 9–20 floor, never widen it.
export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data, error } = await db
      .from('comm_hours_policy')
      .select('id, enabled, start_hour, end_hour, days, timezone_offset_hours, is_assumption, note, updated_at')
      .eq('id', 'global')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ policy: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

const PutSchema = z
  .object({
    enabled: z.boolean().optional(),
    start_hour: z.number().int().min(0).max(23).optional(),
    end_hour: z.number().int().min(1).max(24).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    timezone_offset_hours: z.number().min(-12).max(14).optional(),
  })
  .refine((v) => v.start_hour === undefined || v.end_hour === undefined || v.end_hour > v.start_hour, {
    message: 'end_hour must be after start_hour',
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
    const before = await db.from('comm_hours_policy').select('*').eq('id', 'global').maybeSingle()
    if (before.error) return NextResponse.json({ error: before.error.message }, { status: 500 })

    // Cross-field guard against the stored row when only one bound is supplied.
    const start = v.data.start_hour ?? before.data?.start_hour ?? 9
    const end = v.data.end_hour ?? before.data?.end_hour ?? 20
    if (end <= start) return NextResponse.json({ error: 'end_hour must be after start_hour' }, { status: 400 })

    const patch: Record<string, unknown> = { is_assumption: false, updated_at: new Date().toISOString() }
    if (v.data.enabled !== undefined) patch.enabled = v.data.enabled
    if (v.data.start_hour !== undefined) patch.start_hour = v.data.start_hour
    if (v.data.end_hour !== undefined) patch.end_hour = v.data.end_hour
    if (v.data.days !== undefined) patch.days = v.data.days
    if (v.data.timezone_offset_hours !== undefined) patch.timezone_offset_hours = v.data.timezone_offset_hours

    // Upsert the singleton so a fresh install (no seed row yet) still saves.
    const { data, error } = await db
      .from('comm_hours_policy')
      .upsert({ id: 'global', ...patch }, { onConflict: 'id' })
      .select('id, enabled, start_hour, end_hour, days, timezone_offset_hours, is_assumption, note, updated_at')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'config.changed',
      entity: 'comm_hours_policy',
      entityId: 'global',
      diff: { before: before.data, after: patch },
    })
    return NextResponse.json({ policy: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
