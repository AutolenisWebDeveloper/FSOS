import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, dbErrorResponse } from '@/lib/http'
import { sendEmail, emailConfigured } from '@/lib/messaging'
import { renderEmailShell, paragraphHtml, detailTableHtml, calloutHtml } from '@/lib/notifications/email-shell'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC workshop registration.
//   GET  ?workshop_id=  → safe public details for the registration page
//   POST { workshop_id, name, email, phone? } → registers the attendee,
//         links/creates a customer by email, sends a confirmation email.
const RegSchema = z.object({
  workshop_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).optional(),
  interest_level: z.enum(['high', 'medium', 'low']).optional(),
})

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('workshop_id')
  if (!id) return NextResponse.json({ error: 'workshop_id is required' }, { status: 400 })

  const supabase = getDb()
  const { data: w, error } = await supabase
    .from('workshops')
    .select('workshop_id, title, topic, scheduled_at, location, max_attendees')
    .eq('workshop_id', id)
    .maybeSingle()
  if (error) return dbErrorResponse('workshops/register', error)
  if (!w) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

  const { count } = await supabase
    .from('workshop_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('workshop_id', id)
  const registered = count || 0
  return NextResponse.json({
    workshop: {
      workshop_id: w.workshop_id,
      title: w.title,
      topic: w.topic,
      scheduled_at: w.scheduled_at,
      location: w.location,
      seats_remaining: w.max_attendees ? Math.max(0, w.max_attendees - registered) : null,
      is_full: !!w.max_attendees && registered >= w.max_attendees,
    },
  })
}

export async function POST(req: NextRequest) {
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = RegSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Please provide your name and a valid email.' }, { status: 400 })
  const { workshop_id, name, email, phone, interest_level } = v.data

  const supabase = getDb()
  const { data: w } = await supabase
    .from('workshops')
    .select('workshop_id, title, scheduled_at, location, max_attendees')
    .eq('workshop_id', workshop_id)
    .maybeSingle()
  if (!w) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

  const { count } = await supabase
    .from('workshop_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('workshop_id', workshop_id)
  if (w.max_attendees && (count || 0) >= w.max_attendees) {
    return NextResponse.json({ error: 'This workshop is full.' }, { status: 409 })
  }

  // Link or create a customer by email so the registrant lands in the book.
  const lower = email.toLowerCase()
  let customer_id: string | null = null
  const { data: existing } = await supabase.from('customers').select('customer_id').eq('email', lower).maybeSingle()
  if (existing) customer_id = existing.customer_id
  else {
    const parts = name.trim().split(/\s+/)
    const { data: created } = await supabase
      .from('customers')
      .insert({ first_name: parts[0] || 'Guest', last_name: parts.slice(1).join(' ') || '', email: lower, phone: phone || null, source: 'workshop' })
      .select('customer_id')
      .single()
    if (created) customer_id = created.customer_id
  }

  const { error: regErr } = await supabase
    .from('workshop_registrations')
    .insert({ workshop_id, customer_id, interest_level: interest_level || null })
  if (regErr) {
    console.error('[workshop-register] insert error:', regErr)
    return NextResponse.json({ error: 'Could not complete registration. Please try again.' }, { status: 500 })
  }

  // Confirmation email (transactional — a registration receipt, NOT gated by
  // marketing consent). Best-effort: it never blocks the registration result, but a
  // provider rejection is logged, not silently dropped, so a bad Resend config is
  // diagnosable instead of leaving registrants with no confirmation and no trace.
  if (emailConfigured()) {
    const when = w.scheduled_at ? new Date(w.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' }) : 'TBA'
    const confirmationHtml = renderEmailShell({
      preheader: `You're registered for ${w.title}`,
      eyebrow: 'Registration Confirmed',
      heading: `You're registered, ${name}!`,
      contentHtml: [
        paragraphHtml(`Thank you for registering for ${w.title}. We're looking forward to seeing you.`),
        detailTableHtml([
          { label: 'Event', value: w.title },
          { label: 'When', value: when },
          { label: 'Where', value: w.location || 'Details to follow' },
        ]),
        calloutHtml("We'll send a reminder before the event — nothing else to do for now."),
      ].join('\n'),
    })
    // GATED. This route has no in-repo caller (both public forms post to
    // /api/public/workshops/register) but is an unauthenticated, publicly reachable POST,
    // so it must be gated rather than assumed dead.
    const sent = await sendEmail(email, `You're registered — ${w.title}`, confirmationHtml, undefined, {
      policy: {
        actor: 'system:workshop-register',
        purpose: 'TRANSACTIONAL',
        templateKind: 'system_transactional',
        suppressible: false,
        // The registration was persisted immediately above and this address was supplied
        // for its confirmation.
        durableConsentGranted: true,
      },
    })
    if (!sent.ok) {
      console.error('[workshop-register] confirmation email failed (registration kept):', sent.error)
    }
  } else {
    console.warn('[workshop-register] email not configured — confirmation not sent (registration kept)')
  }

  return NextResponse.json({ success: true, workshop: w.title })
}
