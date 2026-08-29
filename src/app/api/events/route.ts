import { NextResponse } from 'next/server'
import { dbErrorResponse } from '@/lib/http'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC GET /api/events — upcoming PUBLISHED workshops (safe fields only) for the
// public /events index. Past events are excluded. WS-038: draft/pending/cancelled
// workshops previously leaked here because no status filter was applied — the publish
// gate is the single door to every public surface.
export async function GET() {
  const supabase = getDb()
  const nowISO = new Date().toISOString()
  const { data, error } = await supabase
    .from('workshops')
    .select('workshop_id, title, topic, scheduled_at, location')
    .eq('status', 'published')
    .gte('scheduled_at', nowISO)
    .order('scheduled_at', { ascending: true })
    .limit(50)
  if (error) return dbErrorResponse('events', error)
  return NextResponse.json({ events: data || [] })
}
