import { NextRequest, NextResponse } from 'next/server'
import { verifyTwilioSignature, requestUrl } from '@/lib/comms/twilio'
import { findMessageByProviderId, recordMessageEvent, normalizeProviderEvent } from '@/lib/comms/events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/twilio/status
// ─────────────────────────────────────────────────────────────────────────
// Twilio delivery-status callback (set as StatusCallback on each outbound send in
// lib/messaging.ts). Twilio posts MessageStatus = queued|sent|delivered|
// undelivered|failed with the MessageSid. We map it to a normalized event and
// advance the matching comm_messages lifecycle (delivered_at / failed_at / status).
// ─────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const params = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>
  const signature = req.headers.get('x-twilio-signature')

  if (!verifyTwilioSignature(requestUrl(req), params, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const providerId = params.MessageSid || params.SmsSid || ''
  const status = params.MessageStatus || params.SmsStatus || ''
  const event = normalizeProviderEvent(status)

  if (providerId && event) {
    try {
      const msg = await findMessageByProviderId(providerId)
      await recordMessageEvent({
        messageId: msg?.id ?? null,
        conversationId: msg?.conversation_id ?? null,
        campaignId: msg?.campaign_id ?? null,
        event,
        channel: 'sms',
        detail: params.ErrorCode ? `error ${params.ErrorCode}` : null,
        providerId,
      })
    } catch (err) {
      console.error('[twilio:status] handler error:', err)
    }
  }

  return NextResponse.json({ received: true })
}
