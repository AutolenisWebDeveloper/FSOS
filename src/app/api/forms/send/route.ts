import { NextRequest, NextResponse } from 'next/server'
import { requireInternalAuth, readJson } from '@/lib/http'
import { sendForm, type SendChannel } from '@/lib/forms'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
