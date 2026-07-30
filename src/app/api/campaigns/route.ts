import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson, callerLabel, dbErrorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// /api/campaigns  (internal)
//   GET  — list campaigns with enrollment counts
//   POST — create { name, channel, steps: [{ delay_days, subject?, body }] }
const StepSchema = z.object({
  delay_days: z.number().int().min(0).max(365),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(2000),
})
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  channel: z.enum(['email', 'sms']),
  steps: z.array(StepSchema).min(1).max(20),
})

export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const supabase = getDb()
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return dbErrorResponse('campaigns', error)

  // Attach enrollment counts per campaign (active / completed / total). One query
  // for all listed campaigns tallied in memory, instead of 3 COUNT round-trips per
  // campaign (the previous 3N N+1). Only the two needed columns are fetched.
  const ids = (campaigns || []).map((c) => c.campaign_id)
  const counts = new Map<string, { total: number; active: number; completed: number }>()
  if (ids.length) {
    const { data: enrollments } = await supabase
      .from('campaign_enrollments')
      .select('campaign_id, status')
      .in('campaign_id', ids)
    for (const e of enrollments || []) {
      const m = counts.get(e.campaign_id) ?? { total: 0, active: 0, completed: 0 }
      m.total += 1
      if (e.status === 'active') m.active += 1
      else if (e.status === 'completed') m.completed += 1
      counts.set(e.campaign_id, m)
    }
  }
  const withCounts = (campaigns || []).map((c) => ({
    ...c,
    enrollments: counts.get(c.campaign_id) ?? { total: 0, active: 0, completed: 0 },
  }))
  return NextResponse.json({ campaigns: withCounts })
}

export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid campaign', details: v.error.flatten() }, { status: 400 })

  // Normalize step order 0..n.
  const steps = v.data.steps.map((s, i) => ({ order: i, ...s }))
  const supabase = getDb()
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ name: v.data.name, channel: v.data.channel, steps, created_by: callerLabel(req) })
    .select('*')
    .single()
  if (error) return dbErrorResponse('campaigns', error)
  return NextResponse.json({ campaign: data }, { status: 201 })
}
