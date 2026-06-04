import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { createHmac } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/calendly
// Receives appointment events from Calendly
// Replaces /api/webhooks/ghl — same downstream logic:
//   invitee.created → upsert customer, log activity, auto-send 2 forms
//   invitee.canceled → log cancellation in activity
//
// Calendly webhook setup:
//   Calendly → Integrations → Webhooks → New webhook subscription
//   URL: https://fsos-seven.vercel.app/api/webhooks/calendly
//   Events: invitee.created, invitee.canceled
//   Signing key: copy value → set as CALENDLY_WEBHOOK_SECRET in Vercel env vars

function verifyCalendlySignature(body: string, signature: string): boolean {
  const secret = process.env.CALENDLY_WEBHOOK_SECRET
  if (!secret) return true // skip verification in dev/if not configured
  const expected = createHmac('sha256', secret)
    .update(body)
    .digest('hex')
  // Calendly sends: "v1=<hex_signature>"
  const sig = signature.replace('v1=', '')
  return expected === sig
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('calendly-webhook-signature') || ''

  if (!verifyCalendlySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: Record<string, any>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = payload.event as string // 'invitee.created' | 'invitee.canceled'

  try {
    if (eventType === 'invitee.created') {
      await handleInviteeCreated(payload)
    } else if (eventType === 'invitee.canceled') {
      await handleInviteeCanceled(payload)
    }
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('Calendly webhook error:', err)
    // Always return 200 — Calendly retries on non-2xx which can spam
    return NextResponse.json({ received: true, error: 'Handler error logged' })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInviteeCreated(payload: Record<string, any>) {
  const supabase = getDb()

  // Calendly payload structure:
  // payload.payload.invitee = { email, name, timezone, ... }
  // payload.payload.event   = { start_time, end_time, name (event type), location }
  const invitee   = payload.payload?.invitee   || {}
  const eventData = payload.payload?.event     || {}
  const questions = payload.payload?.questions_and_answers || []

  const email = invitee.email as string
  const name  = (invitee.name as string) || ''
  const phone = extractPhone(questions) // Calendly can ask for phone in custom questions

  if (!email && !name) return

  const nameParts = name.trim().split(' ')
  const first_name = nameParts[0] || 'Unknown'
  const last_name  = nameParts.slice(1).join(' ') || ''

  // 1. Upsert customer
  let customer_id: string | null = null

  if (email) {
    const { data: existing } = await supabase
      .from('customers')
      .select('customer_id, first_name, last_name, consent_email')
      .eq('email', email.toLowerCase())
      .maybeSingle()

    if (existing) {
      customer_id = existing.customer_id
      // Update phone if we got it from Calendly questions
      if (phone) {
        await supabase.from('customers').update({ phone }).eq('customer_id', customer_id)
      }
    } else {
      const { data: newC } = await supabase
        .from('customers')
        .insert({
          first_name,
          last_name,
          email: email.toLowerCase(),
          phone: phone || null,
          source: 'calendly',
          consent_email: true,
          consent_sms: !!phone,
          consent_date: new Date().toISOString(),
        })
        .select('customer_id')
        .single()

      if (newC) customer_id = newC.customer_id
    }
  }

  if (!customer_id) return

  // 2. Log appointment activity
  await supabase.from('activity').insert({
    customer_id,
    type: 'appointment',
    direction: 'inbound',
    channel: 'calendly',
    subject: `Appointment booked — ${(eventData.name as string) || 'Financial Review'}`,
    notes: `Via Calendly · ${(eventData.start_time as string) || ''} · ${invitee.timezone || ''}`,
  })

  // 3. Auto-send 2 forms if customer has email consent (prevent duplicates)
  const { data: customer } = await supabase
    .from('customers')
    .select('consent_email, email, first_name, last_name')
    .eq('customer_id', customer_id)
    .single()

  if (!customer?.consent_email || !customer.email) return

  const { data: existingForm } = await supabase
    .from('form_submissions')
    .select('submission_id')
    .eq('customer_id', customer_id)
    .eq('form_id', 'customer-questionnaire')
    .in('status', ['sent', 'opened', 'complete'])
    .maybeSingle()

  if (existingForm) return // forms already sent for this customer

  const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'
  const clientName = `${customer.first_name} ${customer.last_name}`.trim()

  // Fire both form sends in parallel — non-blocking
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
      }),
    }),
  ])
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInviteeCanceled(payload: Record<string, any>) {
  const supabase = getDb()
  const invitee   = payload.payload?.invitee   || {}
  const eventData = payload.payload?.event     || {}
  const email = invitee.email as string

  if (!email) return

  const { data: customer } = await supabase
    .from('customers')
    .select('customer_id')
    .eq('email', email.toLowerCase())
    .maybeSingle()

  if (!customer) return

  await supabase.from('activity').insert({
    customer_id: customer.customer_id,
    type: 'note',
    direction: 'inbound',
    channel: 'calendly',
    subject: `Appointment canceled — ${(eventData.name as string) || 'Financial Review'}`,
    notes: `Canceled via Calendly · Originally: ${(eventData.start_time as string) || ''}`,
  })
}

// Extract phone from Calendly custom questions array
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPhone(questions: any[]): string | null {
  for (const q of questions) {
    const answer = (q.answer as string) || ''
    const question = ((q.question as string) || '').toLowerCase()
    if (question.includes('phone') || question.includes('mobile') || question.includes('cell')) {
      const digits = answer.replace(/\D/g, '')
      if (digits.length === 10) return digits
      if (digits.length === 11 && digits[0] === '1') return digits.slice(1)
    }
  }
  return null
}
