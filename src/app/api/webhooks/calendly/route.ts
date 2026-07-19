import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { sendForm } from '@/lib/forms'
import { createHmac, timingSafeEqual } from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/calendly
// Calendly v2 webhook. Setup:
//   Calendly → Integrations → Webhooks → subscribe invitee.created, invitee.canceled
//   URL: https://<your-domain>/api/webhooks/calendly
//   Signing key → set as CALENDLY_WEBHOOK_SECRET
//
// invitee.created  → upsert customer, log activity, auto-send intake forms
// invitee.canceled → log cancellation

const REPLAY_WINDOW_SECONDS = 300

// Header format: "t=1601510400,v1=<hex>"; signed payload is `${t}.${rawBody}`.
function verifyCalendlySignature(rawBody: string, header: string): boolean {
  const secret = process.env.CALENDLY_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed in production; allow through only in non-prod for local testing.
    return process.env.NODE_ENV !== 'production'
  }
  if (!header) return false

  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=')
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]
    }),
  ) as { t?: string; v1?: string }

  if (!parts.t || !parts.v1) return false

  const ts = Number.parseInt(parts.t, 10)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() / 1000 - ts) > REPLAY_WINDOW_SECONDS) return false

  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(parts.v1, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
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

  const eventType = payload.event as string

  try {
    if (eventType === 'invitee.created') {
      await handleInviteeCreated(payload)
    } else if (eventType === 'invitee.canceled') {
      await handleInviteeCanceled(payload)
    }
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('Calendly webhook error:', err)
    // Return 200 so Calendly does not retry-storm; the error is logged.
    return NextResponse.json({ received: true, error: 'Handler error logged' })
  }
}

// In Calendly API v2, invitee fields are directly on payload.payload; the event
// is payload.payload.scheduled_event.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInviteeCreated(payload: Record<string, any>) {
  const supabase = getDb()

  const invitee = payload.payload || {}
  const eventData = invitee.scheduled_event || {}
  const questions = invitee.questions_and_answers || []

  const email = (invitee.email as string) || ''
  const name = (invitee.name as string) || ''
  const phone = extractPhone(questions)

  if (!email && !name) return

  const nameParts = name.trim().split(' ')
  const first_name = nameParts[0] || 'Unknown'
  const last_name = nameParts.slice(1).join(' ') || ''

  let customer_id: string | null = null

  if (email) {
    const { data: existing } = await supabase
      .from('customers')
      .select('customer_id, consent_email')
      .eq('email', email.toLowerCase())
      .maybeSingle()

    if (existing) {
      customer_id = existing.customer_id
      if (phone) await supabase.from('customers').update({ phone }).eq('customer_id', customer_id)
    } else {
      const { data: newC } = await supabase
        .from('customers')
        .insert({
          first_name,
          last_name,
          email: email.toLowerCase(),
          phone: phone || null,
          source: 'calendly',
          consent_email: true, // booking through our own funnel = email opt-in
          consent_date: new Date().toISOString(),
        })
        .select('customer_id')
        .single()
      if (newC) customer_id = newC.customer_id
    }
  }

  if (!customer_id) return

  // Record the email consent event in the TCPA/consent audit ledger.
  // Note: we intentionally do NOT infer SMS consent from a booking — TCPA
  // requires prior express written consent for automated SMS.
  await supabase.from('consent_ledger').insert({
    customer_id,
    channel: 'email',
    status: 'opted_in',
    source: 'calendly',
    notes: 'Booked appointment via Calendly',
  })

  await supabase.from('activity').insert({
    customer_id,
    type: 'appointment',
    direction: 'inbound',
    channel: 'calendly',
    subject: `Appointment booked — ${(eventData.name as string) || 'Financial Review'}`,
    notes: `Via Calendly · ${(eventData.start_time as string) || ''} · ${invitee.timezone || ''}`,
  })

  // Auto-send the two intake forms (in-process — no HTTP self-fetch).
  const { data: customer } = await supabase
    .from('customers')
    .select('consent_email, email, first_name, last_name')
    .eq('customer_id', customer_id)
    .single()

  if (!customer?.consent_email || !customer.email) return
  const clientName = `${customer.first_name} ${customer.last_name}`.trim()

  await Promise.allSettled([
    sendForm({
      customer_id,
      form_id: 'customer-questionnaire',
      channel: 'email',
      email: customer.email,
      client_name: clientName,
    }),
    sendForm({
      customer_id,
      form_id: 'financial-needs-analysis',
      channel: 'email',
      email: customer.email,
      client_name: clientName,
    }),
  ])
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInviteeCanceled(payload: Record<string, any>) {
  const supabase = getDb()
  const invitee = payload.payload || {}
  const eventData = invitee.scheduled_event || {}
  const email = (invitee.email as string) || ''
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
