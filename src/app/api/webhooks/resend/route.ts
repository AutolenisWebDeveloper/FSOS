import { NextRequest, NextResponse } from 'next/server'
import { verifyResendSignature } from '@/lib/comms/resend'
import { findMessageByProviderId, recordMessageEvent, normalizeProviderEvent } from '@/lib/comms/events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/resend
// ─────────────────────────────────────────────────────────────────────────
// Resend event webhook (Resend dashboard → Webhooks → add this URL, copy the
// signing secret into RESEND_WEBHOOK_SECRET). Delivers email.sent / delivered /
// opened / clicked / bounced / complained events, Svix-signed. We map each to a
// normalized event and advance the matching comm_messages lifecycle. Resend
// includes the send's message id in data.email_id, which equals the provider_id we
// stored at send time.
// ─────────────────────────────────────────────────────────────────────────

interface ResendEvent {
  type?: string
  data?: {
    email_id?: string
    click?: { link?: string }
    bounce?: { message?: string }
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifyResendSignature(raw, req.headers)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let evt: ResendEvent
  try {
    evt = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = normalizeProviderEvent(evt.type || '')
  const providerId = evt.data?.email_id || ''

  if (event && providerId) {
    try {
      const msg = await findMessageByProviderId(providerId)
      const detail = evt.data?.click?.link || evt.data?.bounce?.message || null
      await recordMessageEvent({
        messageId: msg?.id ?? null,
        conversationId: msg?.conversation_id ?? null,
        campaignId: msg?.campaign_id ?? null,
        event,
        channel: 'email',
        detail,
        providerId,
      })
    } catch (err) {
      console.error('[resend] handler error:', err)
    }
  }

  return NextResponse.json({ received: true })
}
