import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/dashboard
// Returns all data needed for Daily Briefing + Dashboard pages
export async function GET(req: NextRequest) {
  const supabase = getDb()
  const scope = req.nextUrl.searchParams.get('scope')

  // Scoped query: workshops only
  if (scope === 'workshops') {
    const { data, error } = await supabase
      .from('workshops')
      .select(`
        workshop_id, title, topic, scheduled_at, max_attendees, location,
        workshop_registrations(reg_id, attended, appointment_booked)
      `)
      .gte('scheduled_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(20)

    if (error) return NextResponse.json({ workshops: [] })

    const workshops = (data || []).map(w => ({
      ...w,
      registered_count: Array.isArray(w.workshop_registrations) ? w.workshop_registrations.length : 0,
      attended_count: Array.isArray(w.workshop_registrations) ? w.workshop_registrations.filter((r: { attended: boolean }) => r.attended).length : 0,
      appointments_booked: Array.isArray(w.workshop_registrations) ? w.workshop_registrations.filter((r: { appointment_booked: boolean }) => r.appointment_booked).length : 0,
    }))

    return NextResponse.json({ workshops })
  }
  try {
    const supabase = getDb()

    const [
      briefing,
      urgentConversions,
      opraDue,
      topOpportunities,
      recentReferrals,
      pendingForms,
      gdcSummary,
    ] = await Promise.all([

      supabase
        .from('daily_briefings')
        .select('*')
        .eq('briefing_date', new Date().toISOString().split('T')[0])
        .maybeSingle(),

      supabase
        .from('policies')
        .select(`
          policy_id, policy_number, face_amount, annual_premium, conversion_deadline, days_to_deadline, status,
          customers!inner (customer_id, first_name, last_name, phone, email,
            agencies (name, owner)
          )
        `)
        .in('policy_type', ['term', 'term_life'])
        .eq('status', 'active')
        .not('conversion_deadline', 'is', null)
        .gte('conversion_deadline', new Date().toISOString().split('T')[0])
        .lte('days_to_deadline', 90)
        .order('days_to_deadline', { ascending: true })
        .limit(20),

      supabase
        .from('opra_cases')
        .select(`
          *,
          customers (customer_id, first_name, last_name, phone, email,
            agencies (name)
          )
        `)
        .eq('contacted', false)
        .order('created_at', { ascending: true })
        .limit(15),

      supabase
        .from('scores')
        .select(`
          *,
          customers!inner (
            customer_id, first_name, last_name, phone, email,
            has_life, has_auto, has_home, age, marital_status,
            agencies (agency_id, name, owner)
          )
        `)
        .gt('priority_score', 30)
        .order('priority_score', { ascending: false })
        .limit(25),

      supabase
        .from('agency_referrals')
        .select('*, agencies (name, owner)')
        .gte('submitted_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('submitted_at', { ascending: false })
        .limit(20),

      supabase
        .from('form_submissions')
        .select('submission_id, form_title, sent_at, customer_id, customers (first_name, last_name)')
        .eq('status', 'sent')
        .gt('expires_at', new Date().toISOString())
        .order('sent_at', { ascending: false })
        .limit(20),

      supabase
        .from('commission_cases')
        .select('case_status, estimated_gdc, estimated_fsa, actual_gdc, actual_fsa, issued_date')
        .not('case_status', 'eq', 'cancelled'),
    ])

    // Calculate GDC totals
    const gdcData = gdcSummary.data || []
    const currentYear = new Date().getFullYear()

    const gdcTotals = gdcData.reduce(
      (acc, c) => {
        if (c.case_status === 'issued' || c.case_status === 'paid') {
          const isThisYear = c.issued_date && new Date(c.issued_date).getFullYear() === currentYear
          if (isThisYear) {
            acc.issued_ytd += (c.actual_gdc || c.estimated_gdc || 0)
            acc.fsa_ytd += (c.actual_fsa || c.estimated_fsa || 0)
          }
        }
        if (c.case_status === 'submitted' || c.case_status === 'pending') {
          acc.pipeline += (c.estimated_gdc || 0)
          acc.pipeline_fsa += (c.estimated_fsa || 0)
        }
        return acc
      },
      { issued_ytd: 0, fsa_ytd: 0, pipeline: 0, pipeline_fsa: 0 }
    )

    // Determine tier
    const tier = gdcTotals.issued_ytd >= 55000 ? 3 : gdcTotals.issued_ytd >= 15000 ? 2 : 1
    const tierRate = tier === 3 ? 0.80 : tier === 2 ? 0.60 : 0.40

    return NextResponse.json({
      briefing: briefing.data,
      urgent_conversions: urgentConversions.data || [],
      opra_due: opraDue.data || [],
      top_opportunities: topOpportunities.data || [],
      recent_referrals: recentReferrals.data || [],
      pending_forms: pendingForms.data || [],
      gdc: {
        ...gdcTotals,
        tier,
        tier_rate: tierRate,
        tier_label: `Tier ${tier}`,
      },
      counts: {
        urgent_conversions: (urgentConversions.data || []).filter(c => (c.days_to_deadline || 999) <= 30).length,
        opra_due: opraDue.data?.length || 0,
        pending_forms: pendingForms.data?.length || 0,
        new_referrals: recentReferrals.data?.length || 0,
      },
      generated_at: new Date().toISOString(),
    })

  } catch (err) {
    console.error('Dashboard API error:', err)
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 })
  }
}
