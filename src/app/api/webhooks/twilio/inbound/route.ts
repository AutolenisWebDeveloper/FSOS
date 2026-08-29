import { NextRequest, NextResponse } from 'next/server'
import { verifyTwilioSignature, requestUrl, emptyTwiml, messageTwiml } from '@/lib/comms/twilio'
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

  let helpResponse: string | undefined
  try {
    const result = await processInbound({ channel: 'sms', from, body, provider: 'twilio', providerId })
    helpResponse = result.helpResponse
  } catch (err) {
    console.error('[twilio:inbound] handler error:', err)
  }

  // WS-033: a bare HELP/INFO keyword gets the carrier-required identification reply as
  // the webhook's own TwiML response — a direct answer to the inbound message (delivered
  // regardless of opt-out state), never an outbound API send. Everything else stays an
  // empty TwiML ack; any conversational reply goes out asynchronously through the gate.
  const twiml = helpResponse ? messageTwiml(helpResponse) : emptyTwiml()
  return new NextResponse(twiml, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}
