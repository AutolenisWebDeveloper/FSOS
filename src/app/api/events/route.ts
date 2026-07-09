import { NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC GET /api/events — upcoming workshops (safe fields only) for the public
// /events index. Past events are excluded.
export async function GET() {
  const supabase = getDb()
  const nowISO = new Date().toISOString()
  const { data, error } = await supabase
    .from('workshops')
    .select('workshop_id, title, topic, scheduled_at, location')
    .gte('scheduled_at', nowISO)
    .order('scheduled_at', { ascending: true })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data || [] })
}
