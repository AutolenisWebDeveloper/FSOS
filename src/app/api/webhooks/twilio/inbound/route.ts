import { NextRequest, NextResponse } from 'next/server'
import { verifyTwilioSignature, requestUrl, emptyTwiml } from '@/lib/comms/twilio'
import { processInbound } from '@/lib/comms/inbound'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/twilio/inbound
// ─────────────────────────────────────────────────────────────────────────
// Twilio posts an inbound SMS here (Console → Phone Numbers → Messaging →
// "A message comes in" → Webhook → this URL). We verify the X-Twilio-Signature,
// thread the message into the contact's conversation (auto-associated to member/
// household/agency), record full history, honor STOP/START/HELP immediately, and
// optionally draft a green-zone AI reply (through the gate). We reply with empty
// TwiML — any outbound reply is sent asynchronously via the gated dispatcher, not
// inline, so it can never bypass consent/quiet-hours/DNC/securities checks.
// ─────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>
  const signature = req.headers.get('x-twilio-signature')

  if (!verifyTwilioSignature(requestUrl(req), params, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const from = params.From || ''
  const body = params.Body || ''
  const providerId = params.MessageSid || params.SmsSid || null
  if (!from) {
    // Nothing to thread on — acknowledge so Twilio doesn't retry-storm.
    return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
  }

  try {
    await processInbound({ channel: 'sms', from, body, provider: 'twilio', providerId })
  } catch (err) {
    console.error('[twilio:inbound] handler error:', err)
  }

  // Always 200 with empty TwiML; the (optional) reply goes out through the gate.
  return new NextResponse(emptyTwiml(), { status: 200, headers: { 'Content-Type': 'text/xml' } })
}
