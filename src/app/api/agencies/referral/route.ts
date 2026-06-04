import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const supabase = getDb()
    const body = await req.json() as {
      agency_slug: string
      client_name: string
      client_email?: string
      client_phone?: string
      referral_type?: string
      notes?: string
    }
    const { agency_slug, client_name, client_email, client_phone, referral_type, notes } = body

    // 1. Look up agency by slug
    const { data: agency, error: agencyErr } = await supabase
      .from('agencies')
      .select('agency_id, name, owner')
      .eq('slug', agency_slug)
      .single()

    if (agencyErr || !agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    }

    // 2. Check if customer already exists by email
    let customer_id: string | null = null

    if (client_email) {
      const { data: existing } = await supabase
        .from('customers')
        .select('customer_id')
        .eq('email', client_email)
        .maybeSingle()

      if (existing?.customer_id) {
        customer_id = existing.customer_id
      }
    }

    // 3. Create customer if new
    if (!customer_id) {
      const nameParts = (client_name || '').trim().split(' ')
      const first_name = nameParts[0] || 'Unknown'
      const last_name = nameParts.slice(1).join(' ') || ''

      const { data: newCustomer, error: createErr } = await supabase
        .from('customers')
        .insert({
          agency_id: agency.agency_id,
          first_name,
          last_name,
          email: client_email || null,
          phone: client_phone || null,
          source: 'agency_referral',
        })
        .select('customer_id')
        .single()

      if (createErr || !newCustomer) {
        console.error('Create customer error:', createErr)
        return NextResponse.json({ error: 'Failed to create customer record' }, { status: 500 })
      }
      customer_id = newCustomer.customer_id
    }

    // 4. Create referral record
    const { data: referral, error: refErr } = await supabase
      .from('agency_referrals')
      .insert({
        agency_id: agency.agency_id,
        customer_id,
        client_name,
        client_email: client_email || null,
        client_phone: client_phone || null,
        referral_type: referral_type || 'general',
        notes: notes || null,
        status: 'new',
      })
      .select()
      .single()

    if (refErr || !referral) {
      console.error('Create referral error:', refErr)
      return NextResponse.json({ error: 'Failed to create referral' }, { status: 500 })
    }

    // 5. Log activity
    await supabase.from('activity').insert({
      customer_id,
      agency_id: agency.agency_id,
      type: 'note',
      subject: `New referral from ${agency.name}`,
      notes: `Referred by ${agency.owner} · Type: ${referral_type || 'general'}`,
    })

    // 6. Create form submission token for questionnaire
    if (client_email) {
      const { randomUUID } = await import('crypto')
      const token = randomUUID().replace(/-/g, '').slice(0, 16) + Date.now().toString(36)

      await supabase.from('form_submissions').insert({
        customer_id,
        agency_id: agency.agency_id,
        form_id: 'customer-questionnaire',
        form_title: 'Customer Questionnaire',
        token,
        status: 'sent',
        sent_via: 'email',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      })
    }

    return NextResponse.json({
      success: true,
      referral_id: referral.referral_id,
      customer_id,
      message: `Thank you! ${agency.owner} will be in touch soon.`,
    })

  } catch (err) {
    console.error('Referral submission error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const supabase = getDb()
  const agency_id = req.nextUrl.searchParams.get('agency_id')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('agency_referrals')
    .select('*, customers(first_name, last_name, email)')
    .order('submitted_at', { ascending: false })
    .limit(limit)

  if (agency_id) query = query.eq('agency_id', agency_id)

  const { data: referrals, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ referrals: referrals || [] })
}
