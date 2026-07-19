import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson, callerLabel } from '@/lib/http'

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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach enrollment counts per campaign (active / completed / total).
  const withCounts = await Promise.all(
    (campaigns || []).map(async (c) => {
      const [total, active, completed] = await Promise.all([
        supabase.from('campaign_enrollments').select('*', { count: 'exact', head: true }).eq('campaign_id', c.campaign_id),
        supabase.from('campaign_enrollments').select('*', { count: 'exact', head: true }).eq('campaign_id', c.campaign_id).eq('status', 'active'),
        supabase.from('campaign_enrollments').select('*', { count: 'exact', head: true }).eq('campaign_id', c.campaign_id).eq('status', 'completed'),
      ])
      return { ...c, enrollments: { total: total.count || 0, active: active.count || 0, completed: completed.count || 0 } }
    }),
  )
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaign: data }, { status: 201 })
}
