import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, configErrorResponse } from '@/lib/http'
import { getTier } from '@/lib/compliance'
import { ghlSummary } from '@/lib/ghl'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DAY_MS = 24 * 60 * 60 * 1000

function daysBetween(target: string | null): number | null {
  if (!target) return null
  return Math.ceil((new Date(target).getTime() - Date.now()) / DAY_MS)
}

// GET /api/dashboard          → briefing + dashboard aggregate
// GET /api/dashboard?scope=workshops → workshops with registration stats
// GET /api/dashboard?scope=calendar  → upcoming appointments
export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const scope = req.nextUrl.searchParams.get('scope')
  try {
    if (scope === 'workshops') return await workshopsScope()
    if (scope === 'calendar') return await calendarScope()
    return await dashboardScope()
  } catch (err) {
    const configErr = configErrorResponse(err)
    if (configErr) return configErr
    console.error('Dashboard API error:', err)
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 })
  }
}

async function dashboardScope() {
  const db = getDb()
  const today = new Date().toISOString().split('T')[0]
  const in90 = new Date(Date.now() + 90 * DAY_MS).toISOString().split('T')[0]

  const [
    briefing,
    urgentConversions,
    opraDue,
    topOpportunities,
    recentReferrals,
    pendingForms,
    gdcSummary,
    upcomingAppointments,
  ] = await Promise.all([
    db
      .from('daily_briefings')
      .select('*')
      .eq('briefing_date', today)
      .maybeSingle(),

    // Conversions expiring within 90 days — filter/order on the real
    // conversion_deadline column (days_to_deadline is computed below in JS).
    db
      .from('policies')
      .select(`
        policy_id, policy_number, face_amount, annual_premium, conversion_deadline, status,
        customers!inner (customer_id, first_name, last_name, phone, email,
          ghl_contact_id, ghl_opportunity_id, ghl_stage_id, ghl_pipeline_id,
          agencies (name, owner)
        )
      `)
      .in('policy_type', ['term', 'term_life'])
      .eq('status', 'active')
      .not('conversion_deadline', 'is', null)
      .gte('conversion_deadline', today)
      .lte('conversion_deadline', in90)
      .order('conversion_deadline', { ascending: true })
      .limit(20),

    db
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

    db
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

    db
      .from('agency_referrals')
      .select('*, agencies (name, owner)')
      .gte('submitted_at', new Date(Date.now() - 7 * DAY_MS).toISOString())
      .order('submitted_at', { ascending: false })
      .limit(20),

    db
      .from('form_submissions')
      .select('submission_id, form_title, sent_at, customer_id, customers (first_name, last_name)')
      .eq('status', 'sent')
      .gt('expires_at', new Date().toISOString())
      .order('sent_at', { ascending: false })
      .limit(20),

    db
      .from('commission_cases')
      .select('case_status, estimated_gdc, estimated_fsa, actual_gdc, actual_fsa, issued_date')
      .not('case_status', 'eq', 'cancelled'),

    // Upcoming scheduled appointments on the native spine (ADR-027) — count only.
    db
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'scheduled')
      .not('starts_at', 'is', null)
      .gte('starts_at', new Date().toISOString()),
  ])

  // Attach days_to_deadline to each conversion row for the UI.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conversions = (urgentConversions.data || []).map((c: any) => ({
    ...c,
    days_to_deadline: daysBetween(c.conversion_deadline),
    ghl: ghlSummary(c.customers),
  }))

  // Rolling 12-month GDC drives the tier.
  const cutoff = new Date(Date.now() - 365 * DAY_MS)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gdcData: any[] = gdcSummary.data || []
  const gdcTotals = gdcData.reduce(
    (acc, c) => {
      if (c.case_status === 'issued' || c.case_status === 'paid') {
        if (c.issued_date && new Date(c.issued_date) >= cutoff) {
          acc.issued_ytd += c.actual_gdc || c.estimated_gdc || 0
          acc.fsa_ytd += c.actual_fsa || c.estimated_fsa || 0
        }
      }
      if (c.case_status === 'submitted' || c.case_status === 'pending') {
        acc.pipeline += c.estimated_gdc || 0
        acc.pipeline_fsa += c.estimated_fsa || 0
      }
      return acc
    },
    { issued_ytd: 0, fsa_ytd: 0, pipeline: 0, pipeline_fsa: 0 },
  )

  const tierInfo = getTier(gdcTotals.issued_ytd)

  return NextResponse.json({
    briefing: briefing.data,
    urgent_conversions: conversions,
    opra_due: opraDue.data || [],
    top_opportunities: topOpportunities.data || [],
    recent_referrals: recentReferrals.data || [],
    pending_forms: pendingForms.data || [],
    gdc: {
      ...gdcTotals,
      tier: tierInfo.tier,
      tier_rate: tierInfo.rate,
      tier_label: tierInfo.label,
    },
    counts: {
      urgent_conversions: conversions.filter((c) => (c.days_to_deadline ?? 999) <= 30).length,
      opra_due: opraDue.data?.length || 0,
      pending_forms: pendingForms.data?.length || 0,
      new_referrals: recentReferrals.data?.length || 0,
      appointments: upcomingAppointments.count || 0,
    },
    generated_at: new Date().toISOString(),
  })
}

async function workshopsScope() {
  const db = getDb()
  const [{ data: workshops }, { data: regs }] = await Promise.all([
    db.from('workshops').select('*').order('scheduled_at', { ascending: false }).limit(50),
    db.from('workshop_registrations').select('workshop_id, attended, interest_level, appointment_booked'),
  ])

  const stats = new Map<string, { registered: number; attended: number; hot: number; appts: number }>()
  for (const r of (regs || []) as Array<{
    workshop_id: string
    attended: boolean
    interest_level: string | null
    appointment_booked: boolean
  }>) {
    const cur = stats.get(r.workshop_id) || { registered: 0, attended: 0, hot: 0, appts: 0 }
    cur.registered += 1
    if (r.attended) cur.attended += 1
    if (r.interest_level === 'high') cur.hot += 1
    if (r.appointment_booked) cur.appts += 1
    stats.set(r.workshop_id, cur)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enriched = ((workshops || []) as any[]).map((w) => {
    const s = stats.get(w.workshop_id) || { registered: 0, attended: 0, hot: 0, appts: 0 }
    return {
      workshop_id: w.workshop_id,
      title: w.title,
      topic: w.topic,
      scheduled_at: w.scheduled_at,
      location: w.location,
      max_attendees: w.max_attendees,
      registration_link: w.registration_link,
      registered_count: s.registered,
      attended_count: s.attended,
      hot_leads: s.hot,
      appointments_booked: s.appts,
    }
  })

  return NextResponse.json({ workshops: enriched })
}

async function calendarScope() {
  const db = getDb()
  // Native spine (ADR-027): upcoming scheduled appointments straight from the
  // `appointments` aggregate root — the same rows every FSA/client/revenue surface
  // reads. (The legacy Calendly activity-feed calendar was retired in Slice 8.)
  const { data } = await db
    .from('appointments')
    .select('id, starts_at, scheduled_at, status, meeting_mode, booked_via, join_url, contacts (full_name, email, phone)')
    .eq('status', 'scheduled')
    .not('starts_at', 'is', null)
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(50)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appointments = ((data || []) as any[]).map((a) => ({
    appointment_id: a.id,
    subject: a.meeting_mode ? `Appointment (${a.meeting_mode})` : 'Appointment',
    starts_at: a.starts_at ?? a.scheduled_at,
    status: a.status,
    meeting_mode: a.meeting_mode || null,
    booked_via: a.booked_via || null,
    join_url: a.join_url || null,
    client: a.contacts?.full_name || 'Client',
    phone: a.contacts?.phone || null,
    email: a.contacts?.email || null,
  }))

  return NextResponse.json({ appointments })
}
