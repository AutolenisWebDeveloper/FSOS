import { NextRequest, NextResponse } from 'next/server'
import { verifyTwilioSignature, requestUrl } from '@/lib/comms/twilio'
import { findMessageById, findMessageByProviderId, recordMessageEvent, normalizeProviderEvent } from '@/lib/comms/events'
import { isCarrierOptOutCode, recordChannelOptOut } from '@/lib/comms/opt-out'
import { normalizeContact, resolveContact } from '@/lib/comms/conversations'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/twilio/status
// ─────────────────────────────────────────────────────────────────────────
// Twilio delivery-status callback (set as StatusCallback on each outbound send in
// lib/messaging.ts). Twilio posts MessageStatus = queued|sent|delivered|
// undelivered|failed with the MessageSid. We map it to a normalized event and
// advance the matching comm_messages lifecycle (delivered_at / failed_at / status).
//
// It is also the ONLY place a CARRIER-level opt-out becomes visible. Twilio's Advanced Opt-Out
// absorbs STOP at the carrier, so the keyword never reaches /webhooks/twilio/inbound; the
// failure surfaces here as ErrorCode 21610 on an undelivered message. That used to be recorded
// as an event detail string and nothing more, so every later appointment re-attempted the same
// unsubscribed number. It is now applied as a real opt-out, identical to an inbound STOP.
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

  // FSOS-030: correlate deterministically on the echoed message id first (StatusCallback ?mid=,
  // written before the provider could ever call back), then fall back to provider_id for older
  // in-flight sends. `mid` is part of the signed StatusCallback URL, so it is covered by the
  // signature verified above.
  const mid = req.nextUrl.searchParams.get('mid') || ''
  if (event) {
    try {
      const msg = (mid && (await findMessageById(mid))) || (providerId && (await findMessageByProviderId(providerId))) || null
      if (!msg) {
        // Ambiguous correlation → FAIL CLOSED (do not guess a row) but make it OBSERVABLE rather
        // than a silent permanent orphan. The event is still appended (messageId null) below.
        console.error('[twilio:status] uncorrelated callback', { mid: mid || null, providerId: providerId || null, status })
      }
      await recordMessageEvent({
        messageId: msg?.id ?? null,
        conversationId: msg?.conversation_id ?? null,
        campaignId: msg?.campaign_id ?? null,
        event,
        channel: 'sms',
        detail: params.ErrorCode ? `error ${params.ErrorCode}` : null,
        providerId: providerId || null,
      })
    } catch (err) {
      console.error('[twilio:status] handler error:', err)
    }
  }

  // A carrier-reported unsubscribe is an OPT-OUT, not a delivery failure: suppress the number
  // across every consent store so nothing re-attempts it. Deliberately narrow — only the
  // unambiguous 21610 (see isCarrierOptOutCode); filtering and unreachable-handset codes are
  // delivery problems, and treating them as opt-outs would unsubscribe people silently.
  if (isCarrierOptOutCode(params.ErrorCode) && params.To) {
    try {
      const contact = normalizeContact('sms', params.To)
      const link = await resolveContact('sms', contact)
      await recordChannelOptOut({
        contact,
        channel: 'sms',
        source: 'carrier_opt_out',
        reason: `Twilio ErrorCode ${params.ErrorCode} — recipient unsubscribed at the carrier`,
        consentText: 'Carrier-reported opt-out (Twilio 21610)',
        memberId: link.memberId,
        householdId: link.householdId,
      })
    } catch (err) {
      console.error('[twilio:status] carrier opt-out handling failed:', err)
    }
  }

  return NextResponse.json({ received: true })
}
