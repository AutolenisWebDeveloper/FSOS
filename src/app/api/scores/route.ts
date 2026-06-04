import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/scores — Opportunities page. Scored customers across all pipelines.
export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    const pipeline = req.nextUrl.searchParams.get('pipeline')
    const minScore = parseInt(req.nextUrl.searchParams.get('min_score') || '0')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50'), 200)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db
      .from('scores')
      .select(`
        *,
        customers!inner (
          customer_id, first_name, last_name, phone, email, age,
          has_life, has_auto, has_home,
          agencies (agency_id, name, owner)
        )
      `)
      .gte('priority_score', isNaN(minScore) ? 0 : minScore)
      .order('priority_score', { ascending: false })
      .limit(limit)

    if (pipeline) query = query.eq('primary_pipeline', pipeline)

    const { data: opportunities, error } = await query
    if (error) {
      console.error('[scores] query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Pipeline counts across the full scores table
    const { data: allScores } = await db.from('scores').select('primary_pipeline')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (allScores || []) as any[]
    const pipeline_counts = {
      opra: rows.filter((s) => s.primary_pipeline === 'opra').length,
      conversions: rows.filter((s) => s.primary_pipeline === 'conversions').length,
      life: rows.filter((s) => s.primary_pipeline === 'life').length,
      retirement: rows.filter((s) => s.primary_pipeline === 'retirement').length,
      business: rows.filter((s) => s.primary_pipeline === 'business').length,
    }

    return NextResponse.json({ opportunities: opportunities || [], pipeline_counts })
  } catch (err) {
    console.error('[scores] unexpected error:', err)
    return NextResponse.json({ error: 'Failed to load scores' }, { status: 500 })
  }
}
