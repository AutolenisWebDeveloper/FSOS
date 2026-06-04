import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { createHmac } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/ghl
// Receives events from GoHighLevel — appointments, pipeline changes, opt-outs, new contacts

function verifyGHLSignature(body: string, signature: string): boolean {
  if (!process.env.GHL_WEBHOOK_SECRET) return true  // skip verification in dev
  const expected = createHmac('sha256', process.env.GHL_WEBHOOK_SECRET)
    .update(body)
    .digest('hex')
  return expected === signature
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-ghl-signature') || ''

  if (!verifyGHLSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = event.type as string

  try {
    switch (eventType) {
      case 'appointment.created':
      case 'AppointmentBooked':
        await handleAppointmentBooked(event)
        break

      case 'opportunity.stageChanged':
      case 'OpportunityStageChanged':
        await handlePipelineStageChanged(event)
        break

      case 'contact.dnd_updated':
      case 'ContactDNDUpdated':
        await handleOptOut(event)
        break

      case 'contact.created':
      case 'ContactCreated':
        await handleContactCreated(event)
        break

      default:
        console.log('Unhandled GHL event type:', eventType)
    }

    return NextResponse.json({ received: true })

  } catch (err) {
    console.error('GHL webhook handler error:', err)
    // Return 200 to prevent GHL retry storms
    return NextResponse.json({ received: true, error: 'Handler error logged' })
  }
}

async function handleAppointmentBooked(event: Record<string, unknown>) {
  const supabase = getDb()
  const contact = (event.contact as Record<string, unknown>) || {}
  const appointment = (event.appointment as Record<string, unknown>) || {}

  const ghl_contact_id = contact.id as string
  const email = contact.email as string
  const phone = (contact.phone as string) || (contact.phoneNumber as string)
  const name = (contact.name as string) || (contact.fullNameLowerCase as string) || ''

  if (!ghl_contact_id && !email) return

  let customer_id: string | null = null
  const { data: existing } = await supabase
    .from('customers')
    .select('customer_id, first_name, consent_email')
    .or(`ghl_contact_id.eq.${ghl_contact_id},email.eq.${email}`)
    .maybeSingle()

  if (existing) {
    customer_id = existing.customer_id
    if (!existing.consent_email && ghl_contact_id) {
      await supabase.from('customers').update({ ghl_contact_id }).eq('customer_id', customer_id)
    }
  } else {
    const parts = name.trim().split(' ')
    const { data: newC } = await supabase
      .from('customers')
      .insert({
        first_name: parts[0] || 'Unknown',
        last_name: parts.slice(1).join(' ') || '',
        email: email || null,
        phone: phone || null,
        ghl_contact_id,
        source: 'ghl',
        consent_sms: true,
        consent_email: true,
        consent_date: new Date().toISOString(),
      })
      .select('customer_id')
      .single()

    if (newC) customer_id = newC.customer_id
  }

  if (!customer_id) return

  await supabase.from('activity').insert({
    customer_id,
    type: 'appointment',
    direction: 'inbound',
    subject: `Appointment booked — ${(appointment.title as string) || 'Financial Review'}`,
    notes: `Booked via GHL · ${(appointment.startTime as string) || ''}`,
    ghl_activity_id: (appointment.id as string) || null,
  })

  // Auto-send forms if consent on file
  const { data: customer } = await supabase
    .from('customers')
    .select('consent_email, email, first_name, last_name')
    .eq('customer_id', customer_id)
    .single()

  if (customer?.consent_email && customer.email) {
    const { data: existingForm } = await supabase
      .from('form_submissions')
      .select('submission_id')
      .eq('customer_id', customer_id)
      .eq('form_id', 'customer-questionnaire')
      .in('status', ['sent', 'opened', 'complete'])
      .maybeSingle()

    if (!existingForm) {
      const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'
      const clientName = `${customer.first_name} ${customer.last_name}`.trim()

      await Promise.allSettled([
        fetch(`${baseUrl}/api/forms/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id,
            form_id: 'customer-questionnaire',
            channel: 'email',
            destination: customer.email,
            client_name: clientName,
            ghl_contact_id,
          }),
        }),
        fetch(`${baseUrl}/api/forms/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id,
            form_id: 'financial-needs-analysis',
            channel: 'email',
            destination: customer.email,
            client_name: clientName,
            ghl_contact_id,
          }),
        }),
      ])
    }
  }
}

async function handlePipelineStageChanged(event: Record<string, unknown>) {
  const supabase = getDb()
  const opportunity = (event.opportunity as Record<string, unknown>) || {}
  const stage = (opportunity.pipelineStage as Record<string, unknown>) || {}
  const contact = (event.contact as Record<string, unknown>) || {}
  const stageName = ((stage.name as string) || '').toLowerCase()

  if (!opportunity.id) return

  const { data: customer } = await supabase
    .from('customers')
    .select('customer_id')
    .eq('ghl_contact_id', contact.id as string)
    .maybeSingle()

  if (!customer) return

  if (stageName.includes('application submitted') || stageName === 'application_submitted') {
    const { data: existingCase } = await supabase
      .from('commission_cases')
      .select('case_id')
      .eq('ghl_opportunity_id', opportunity.id as string)
      .maybeSingle()

    if (!existingCase) {
      await supabase.from('commission_cases').insert({
        customer_id: customer.customer_id,
        carrier: (opportunity.carrier as string) || 'Unknown',
        product_name: (opportunity.productName as string) || (opportunity.name as string) || 'Unknown',
        product_type: (opportunity.productType as string) || 'unknown',
        premium: opportunity.monetaryValue ? parseFloat(opportunity.monetaryValue as string) : null,
        case_status: 'submitted',
        submitted_at: new Date().toISOString(),
        ghl_opportunity_id: opportunity.id as string,
        pipeline: determinePipeline(opportunity.pipelineName as string),
      })
    }
  }

  await supabase.from('activity').insert({
    customer_id: customer.customer_id,
    type: 'note',
    subject: `GHL pipeline stage: ${(stage.name as string) || stageName}`,
    notes: `Opportunity: ${(opportunity.name as string) || opportunity.id}`,
  })
}

async function handleOptOut(event: Record<string, unknown>) {
  const supabase = getDb()
  const contact = (event.contact as Record<string, unknown>) || {}
  const dnd = (event.dnd as Record<string, unknown>) || {}

  const { data: customer } = await supabase
    .from('customers')
    .select('customer_id')
    .or(`ghl_contact_id.eq.${contact.id},email.eq.${contact.email}`)
    .maybeSingle()

  if (!customer) return

  const channel = (dnd.channel as string) || 'sms'
  await supabase.from('consent_ledger').insert({
    customer_id: customer.customer_id,
    channel,
    status: 'opted_out',
    source: 'ghl_webhook',
    notes: `GHL DND event: ${JSON.stringify(dnd)}`,
  })

  if (channel === 'sms') {
    await supabase.from('customers').update({ consent_sms: false }).eq('customer_id', customer.customer_id)
  } else if (channel === 'email') {
    await supabase.from('customers').update({ consent_email: false }).eq('customer_id', customer.customer_id)
  }
}

async function handleContactCreated(event: Record<string, unknown>) {
  const supabase = getDb()
  const contact = (event.contact as Record<string, unknown>) || {}
  const email = contact.email as string
  const ghl_contact_id = contact.id as string

  if (!email && !ghl_contact_id) return

  const { data: existing } = await supabase
    .from('customers')
    .select('customer_id')
    .or(`ghl_contact_id.eq.${ghl_contact_id}${email ? `,email.eq.${email}` : ''}`)
    .maybeSingle()

  if (!existing) {
    const name = ((contact.name as string) || '').trim().split(' ')
    await supabase.from('customers').insert({
      first_name: name[0] || 'Unknown',
      last_name: name.slice(1).join(' ') || '',
      email: email || null,
      phone: (contact.phone as string) || null,
      ghl_contact_id,
      source: 'ghl',
      consent_sms: !!(contact.phone),
      consent_email: !!email,
      consent_date: new Date().toISOString(),
    })
  } else {
    await supabase
      .from('customers')
      .update({ ghl_contact_id })
      .eq('customer_id', existing.customer_id)
  }
}

function determinePipeline(pipelineName: string): string {
  const name = (pipelineName || '').toLowerCase()
  if (name.includes('conversion')) return 'conversions'
  if (name.includes('opra')) return 'opra'
  if (name.includes('life')) return 'life'
  if (name.includes('retirement')) return 'retirement'
  if (name.includes('business')) return 'business'
  return 'general'
}
