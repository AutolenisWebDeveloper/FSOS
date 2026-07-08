import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth, readJson, parseLimit } from '@/lib/http'
import { sendForm } from '@/lib/forms'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/agencies/referral — public (agency partner submits a referral).
export async function POST(req: NextRequest) {
  try {
    const supabase = getDb()
    const parsed = await readJson<{
      agency_slug: string
      client_name: string
      client_email?: string
      client_phone?: string
      referral_type?: string
      notes?: string
    }>(req)
    if ('error' in parsed) return parsed.error
    const { agency_slug, client_name, client_email, client_phone, referral_type, notes } = parsed.data

    if (!agency_slug || !client_name) {
      return NextResponse.json({ error: 'agency_slug and client_name required' }, { status: 400 })
    }

    const { data: agency, error: agencyErr } = await supabase
      .from('agencies')
      .select('agency_id, name, owner')
      .eq('slug', agency_slug)
      .single()

    if (agencyErr || !agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    }

    let customer_id: string | null = null
    if (client_email) {
      const { data: existing } = await supabase
        .from('customers')
        .select('customer_id')
        .eq('email', client_email.toLowerCase())
        .maybeSingle()
      if (existing?.customer_id) customer_id = existing.customer_id
    }

    if (!customer_id) {
      const nameParts = (client_name || '').trim().split(' ')
      const { data: newCustomer, error: createErr } = await supabase
        .from('customers')
        .insert({
          agency_id: agency.agency_id,
          first_name: nameParts[0] || 'Unknown',
          last_name: nameParts.slice(1).join(' ') || '',
          email: client_email ? client_email.toLowerCase() : null,
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
      .select('referral_id')
      .single()

    if (refErr || !referral) {
      console.error('Create referral error:', refErr)
      return NextResponse.json({ error: 'Failed to create referral' }, { status: 500 })
    }

    await supabase.from('activity').insert({
      customer_id,
      agency_id: agency.agency_id,
      type: 'note',
      subject: `New referral from ${agency.name}`,
      notes: `Referred by ${agency.owner} · Type: ${referral_type || 'general'}`,
    })

    // Actually send the questionnaire (email) rather than leaving a phantom
    // "sent" record the client never receives. Best-effort; failure is logged.
    if (client_email) {
      try {
        await sendForm({
          customer_id,
          agency_id: agency.agency_id,
          form_id: 'customer-questionnaire',
          channel: 'email',
          email: client_email,
          client_name,
        })
      } catch (err) {
        console.error('Referral questionnaire send error:', err)
      }
    }

    return NextResponse.json({
      success: true,
      referral_id: referral.referral_id,
      customer_id,
      owner: agency.owner,
      message: `Thank you! ${agency.owner} will be in touch soon.`,
    })
  } catch (err) {
    console.error('Referral submission error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET — two modes:
//   ?slug=xxx → public agency lookup (referral landing page)
//   (list)    → internal referral list for the command center
export async function GET(req: NextRequest) {
  const supabase = getDb()
  const slug = req.nextUrl.searchParams.get('slug')

  if (slug) {
    const { data: agency, error: slugErr } = await supabase
      .from('agencies')
      .select('agency_id, name, owner, city')
      .eq('slug', slug)
      .maybeSingle()

    if (slugErr || !agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    }
    return NextResponse.json(agency)
  }

  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const agency_id = req.nextUrl.searchParams.get('agency_id')
  const limit = parseLimit(req.nextUrl.searchParams.get('limit'), 50, 200)

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
