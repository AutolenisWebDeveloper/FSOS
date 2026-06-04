import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/opra — OPRA Center page live data
export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    const contactedParam = req.nextUrl.searchParams.get('contacted')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50'), 200)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db
      .from('opra_cases')
      .select(`
        *,
        customers (
          customer_id, first_name, last_name, phone, email,
          agencies (name)
        )
      `)
      .order('created_at', { ascending: true })
      .limit(limit)

    if (contactedParam !== null) {
      query = query.eq('contacted', contactedParam === 'true')
    }

    const { data: cases, error } = await query
    if (error) {
      console.error('[opra] query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Compute counts across the full table (independent of the contacted filter)
    const { data: allCases } = await db
      .from('opra_cases')
      .select('contacted, appt_scheduled, transferred')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (allCases || []) as any[]
    const counts = {
      total: rows.length,
      not_contacted: rows.filter((c) => !c.contacted).length,
      appt_scheduled: rows.filter((c) => c.appt_scheduled).length,
      transferred: rows.filter((c) => c.transferred).length,
    }

    return NextResponse.json({ cases: cases || [], counts })
  } catch (err) {
    console.error('[opra] unexpected error:', err)
    return NextResponse.json({ error: 'Failed to load OPRA cases' }, { status: 500 })
  }
}

// PATCH /api/opra — update OPRA case status (one-click toggles)
export async function PATCH(req: NextRequest) {
  try {
    const db = getDb()
    const body = await req.json()
    const { opra_id, ...rest } = body as Record<string, unknown> & { opra_id?: string }

    if (!opra_id) {
      return NextResponse.json({ error: 'opra_id required' }, { status: 400 })
    }

    const allowed = [
      'contacted', 'contacted_at', 'appt_scheduled', 'appt_date',
      'review_complete', 'review_date', 'transferred', 'transferred_date',
      'status', 'notes',
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
      if (key in rest) updates[key] = (rest as Record<string, unknown>)[key]
    }

    // Convenience: stamp timestamps when a toggle is flipped without an explicit date
    if (updates.contacted === true && !('contacted_at' in updates)) {
      updates.contacted_at = new Date().toISOString()
    }
    if (updates.transferred === true && !('transferred_date' in updates)) {
      updates.transferred_date = new Date().toISOString().split('T')[0]
    }

    const { data, error } = await db
      .from('opra_cases')
      .update(updates)
      .eq('opra_id', opra_id)
      .select(`
        *,
        customers (
          customer_id, first_name, last_name, phone, email,
          agencies (name)
        )
      `)
      .single()

    if (error || !data) {
      console.error('[opra] update error:', error)
      return NextResponse.json({ error: error?.message || 'Case not found' }, { status: 404 })
    }

    return NextResponse.json({ case: data })
  } catch (err) {
    console.error('[opra] unexpected error:', err)
    return NextResponse.json({ error: 'Failed to update OPRA case' }, { status: 500 })
  }
}
