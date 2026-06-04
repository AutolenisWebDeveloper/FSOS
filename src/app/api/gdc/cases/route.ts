import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { getTier } from '@/lib/compliance'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compute the current FSA tier rate from this year's issued/paid GDC.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeTierRate(cases: any[]): { tier: 1 | 2 | 3; rate: 0.40 | 0.60 | 0.80; issued: number } {
  const year = new Date().getFullYear()
  let issued = 0
  for (const c of cases) {
    if ((c.case_status === 'issued' || c.case_status === 'paid') &&
        c.issued_date && new Date(c.issued_date).getFullYear() === year) {
      issued += Number(c.actual_gdc || c.estimated_gdc || 0)
    }
  }
  const t = getTier(issued)
  return { tier: t.tier as 1 | 2 | 3, rate: t.rate as 0.40 | 0.60 | 0.80, issued }
}

// GET /api/gdc/cases — GDC & Commission page live data
export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    const status = req.nextUrl.searchParams.get('status')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50'), 200)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db
      .from('commission_cases')
      .select(`
        *,
        customers (first_name, last_name),
        agencies (name)
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('case_status', status)

    const { data: cases, error } = await query
    if (error) {
      console.error('[gdc/cases] query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Summary uses all non-cancelled cases, not just the filtered/limited page
    const { data: allCases } = await db
      .from('commission_cases')
      .select('case_status, estimated_gdc, actual_gdc, actual_fsa, issued_date')
      .not('case_status', 'eq', 'cancelled')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (allCases || []) as any[]
    const year = new Date().getFullYear()
    let total_issued_ytd = 0
    let total_pipeline = 0
    let total_fsa_ytd = 0
    for (const c of rows) {
      const thisYear = c.issued_date && new Date(c.issued_date).getFullYear() === year
      if ((c.case_status === 'issued' || c.case_status === 'paid') && thisYear) {
        total_issued_ytd += Number(c.actual_gdc || c.estimated_gdc || 0)
        total_fsa_ytd += Number(c.actual_fsa || 0)
      }
      if (c.case_status === 'submitted' || c.case_status === 'pending') {
        total_pipeline += Number(c.estimated_gdc || 0)
      }
    }

    const t = getTier(total_issued_ytd)

    return NextResponse.json({
      cases: cases || [],
      summary: {
        total_issued_ytd,
        total_pipeline,
        total_fsa_ytd,
        tier: t.tier,
        tier_rate: t.rate,
        case_count: rows.length,
      },
    })
  } catch (err) {
    console.error('[gdc/cases] unexpected error:', err)
    return NextResponse.json({ error: 'Failed to load commission cases' }, { status: 500 })
  }
}

// POST /api/gdc/cases — log a new commission case
export async function POST(req: NextRequest) {
  try {
    const db = getDb()
    const body = await req.json()
    const {
      customer_id, carrier, product_name, product_type, product_option,
      client_age, state_code, premium, target_premium, pipeline, notes,
      ghl_opportunity_id,
    } = body as Record<string, unknown>

    if (!carrier || !product_name || !product_type) {
      return NextResponse.json(
        { error: 'carrier, product_name and product_type are required' },
        { status: 400 }
      )
    }

    // Determine the current FSA tier rate from existing issued cases
    const { data: existing } = await db
      .from('commission_cases')
      .select('case_status, estimated_gdc, actual_gdc, issued_date')
      .not('case_status', 'eq', 'cancelled')
    const { rate: tierRate } = computeTierRate((existing || []) as unknown[])

    // 1. Compute the GDC estimate via the Supabase function
    const { data: calc, error: calcErr } = await db.rpc('calculate_case_gdc', {
      p_product_type: product_type,
      p_carrier: carrier,
      p_product: product_name,
      p_option: product_option ?? null,
      p_age: client_age ?? null,
      p_state: state_code ?? 'TX',
      p_premium: premium ?? null,
      p_target_premium: target_premium ?? null,
      p_fsa_tier_rate: tierRate,
    })

    if (calcErr) {
      console.error('[gdc/cases] calculate_case_gdc error:', calcErr)
    }

    // RPC returning a TABLE comes back as an array of rows
    const calcRow = Array.isArray(calc) ? calc[0] : calc
    const gdc = calcRow || {}

    // 2. Insert the case
    const { data: created, error: insErr } = await db
      .from('commission_cases')
      .insert({
        customer_id: (customer_id as string) || null,
        carrier,
        product_name,
        product_type,
        product_option: product_option ?? null,
        client_age: client_age ?? null,
        state_code: (state_code as string) ?? 'TX',
        premium: premium ?? null,
        target_premium: target_premium ?? null,
        pipeline: (pipeline as string) ?? 'general',
        gdc_rate_used: gdc.gdc_rate ?? null,
        estimated_gdc: gdc.estimated_gdc ?? null,
        estimated_fsa: gdc.estimated_fsa ?? null,
        trail_rate_used: gdc.trail_rate ?? null,
        annual_trail: gdc.annual_trail ?? null,
        rate_missing: gdc.rate_missing ?? true,
        case_status: 'pending',
        ghl_opportunity_id: (ghl_opportunity_id as string) || null,
        notes: (notes as string) || null,
      })
      .select(`*, customers (first_name, last_name), agencies (name)`)
      .single()

    if (insErr || !created) {
      console.error('[gdc/cases] insert error:', insErr)
      return NextResponse.json(
        { error: insErr?.message || 'Failed to create case' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, case: created, tier_rate: tierRate })
  } catch (err) {
    console.error('[gdc/cases] unexpected error:', err)
    return NextResponse.json({ error: 'Failed to create commission case' }, { status: 500 })
  }
}

// PATCH /api/gdc/cases — update status, actual amounts, dates
export async function PATCH(req: NextRequest) {
  try {
    const db = getDb()
    const body = await req.json()
    const { case_id, ...rest } = body as Record<string, unknown> & { case_id?: string }

    if (!case_id) {
      return NextResponse.json({ error: 'case_id required' }, { status: 400 })
    }

    const allowed = [
      'case_status', 'actual_gdc', 'actual_fsa',
      'issued_date', 'paid_date', 'submitted_at', 'notes',
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
      if (key in rest) updates[key] = (rest as Record<string, unknown>)[key]
    }

    const { data, error } = await db
      .from('commission_cases')
      .update(updates)
      .eq('case_id', case_id)
      .select(`*, customers (first_name, last_name), agencies (name)`)
      .single()

    if (error || !data) {
      console.error('[gdc/cases] update error:', error)
      return NextResponse.json({ error: error?.message || 'Case not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, case: data })
  } catch (err) {
    console.error('[gdc/cases] unexpected error:', err)
    return NextResponse.json({ error: 'Failed to update commission case' }, { status: 500 })
  }
}
