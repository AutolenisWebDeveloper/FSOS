import { NextRequest, NextResponse } from 'next/server'
import { requireInternalAuth, readJson } from '@/lib/http'
import { sendForm, type SendChannel } from '@/lib/forms'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/forms/send — internal health check. Reports whether the email/SMS
// delivery env is configured (booleans only, never the secret values) so the
// "can't send forms by email" case is self-diagnosable.
export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const from = process.env.RESEND_FROM_EMAIL
  const fromValid = !!from && !/yourdomain\.com/i.test(from)
  return NextResponse.json({
    email: {
      ready: !!process.env.RESEND_API_KEY && fromValid,
      resend_api_key_set: !!process.env.RESEND_API_KEY,
      from_email_set: !!from,
      from_email_valid: fromValid,
      note: 'from_email must be an address on a Resend-verified domain',
    },
    sms: {
      ready:
        !!process.env.TWILIO_ACCOUNT_SID &&
        !!process.env.TWILIO_AUTH_TOKEN &&
        !!process.env.TWILIO_PHONE_NUMBER,
      account_sid_set: !!process.env.TWILIO_ACCOUNT_SID,
      auth_token_set: !!process.env.TWILIO_AUTH_TOKEN,
      phone_number_set: !!process.env.TWILIO_PHONE_NUMBER,
    },
  })
}

// POST /api/forms/send — internal (command center + server-to-server).
// Creates a form submission, emails/texts the secure link, logs the send.
export async function POST(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const parsed = await readJson<{
    customer_id?: string
    form_id?: string
    channel?: SendChannel
    destination?: string
    email?: string
    phone?: string
    client_name?: string
    agency_id?: string
  }>(req)
  if ('error' in parsed) return parsed.error
  const body = parsed.data

  // Accept either explicit email/phone, or a single `destination` interpreted
  // by channel (back-compat with older callers).
  const email = body.email ?? (body.channel !== 'sms' ? body.destination : undefined)
  const phone = body.phone ?? (body.channel === 'sms' ? body.destination : undefined)

  const result = await sendForm({
    form_id: body.form_id || '',
    channel: (body.channel || 'link') as SendChannel,
    email,
    phone,
    client_name: body.client_name,
    customer_id: body.customer_id,
    agency_id: body.agency_id,
  })

  if (!result.ok) {
    if (result.reason === 'already_complete') {
      return NextResponse.json({ success: false, reason: result.reason, message: result.error })
    }
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  // If the caller asked to email/text the link but delivery failed, surface the
  // real reason (bad Resend/Twilio config, unverified sender, etc.) instead of a
  // phantom success. The submission row + link still exist, so we return them.
  const wantedEmail = body.channel === 'email' || body.channel === 'both'
  const wantedSms = body.channel === 'sms' || body.channel === 'both'
  const deliveryFailed =
    (wantedEmail && !result.email_sent) || (wantedSms && !result.sms_sent)

  if (deliveryFailed && !result.reused) {
    const reason =
      result.email_error ||
      result.sms_error ||
      'Delivery failed — check RESEND_API_KEY / RESEND_FROM_EMAIL (email) or Twilio env (SMS)'
    return NextResponse.json(
      {
        success: false,
        error: `Form created but not delivered: ${reason}`,
        link: result.link,
        submission_id: result.submission_id,
        email_sent: result.email_sent,
        sms_sent: result.sms_sent,
        email_error: result.email_error,
        sms_error: result.sms_error,
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    success: true,
    link: result.link,
    token: result.token,
    submission_id: result.submission_id,
    email_sent: result.email_sent,
    sms_sent: result.sms_sent,
    reused: result.reused ?? false,
  })
}
