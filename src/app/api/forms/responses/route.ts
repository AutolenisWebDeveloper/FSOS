import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/forms/responses
// Returns submitted form responses for the FNA Generator page and
// the Submitted Responses tab. Ordered by submitted_at DESC NULLS LAST.
export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    const form_id = req.nextUrl.searchParams.get('form_id')
    const status = req.nextUrl.searchParams.get('status')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50'), 200)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db
      .from('form_submissions')
      .select(`
        submission_id, form_id, form_title, status, submitted_at, sent_at,
        fna_report, fna_urgency, response_data,
        customers (first_name, last_name)
      `)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .limit(limit)

    if (form_id) query = query.eq('form_id', form_id)
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) {
      console.error('[forms/responses] query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ submissions: data || [] })
  } catch (err) {
    console.error('[forms/responses] unexpected error:', err)
    return NextResponse.json({ error: 'Failed to load responses' }, { status: 500 })
  }
}
