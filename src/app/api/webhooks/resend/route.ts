import { NextRequest, NextResponse } from 'next/server'
import { verifyResendSignature } from '@/lib/comms/resend'
import { findMessageById, findMessageByProviderId, recordMessageEvent, normalizeProviderEvent } from '@/lib/comms/events'
import { applyDeliverabilitySuppression } from '@/lib/comms/deliverability'

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
//
// A hard bounce or spam complaint additionally SUPPRESSES the recipient's email via
// the shared suppressContact() → dnc_entries path (gate step 3, §12) so a permanently
// undeliverable / complaining address is never emailed again. Soft/transient bounces
// do not suppress. This closes the one gap in the suppression subsystem (SMS STOP,
// the DNC store, and the gate check already existed) without adding a parallel store.
// ─────────────────────────────────────────────────────────────────────────

interface ResendEvent {
  type?: string
  data?: {
    email_id?: string
    to?: string[] | string
    email?: string
    click?: { link?: string }
    bounce?: { message?: string; type?: string; subType?: string; classification?: string }
    // FSOS-030: Resend echoes custom send headers on email.* events. Shape varies (object map
    // or [{name,value}] array), so we read it defensively.
    headers?: Record<string, string> | Array<{ name?: string; value?: string }>
  }
}

/** Extract the echoed X-FSOS-Message-Id (case-insensitive) from a Resend event, if present. */
function correlationIdFrom(data: ResendEvent['data']): string | null {
  const h = data?.headers
  if (!h) return null
  const KEY = 'x-fsos-message-id'
  if (Array.isArray(h)) {
    const row = h.find((r) => (r?.name ?? '').toLowerCase() === KEY)
    return row?.value ?? null
  }
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === KEY) return typeof v === 'string' ? v : null
  return null
}

/** The recipient address from a Resend event payload (fallback when no stored row). */
function payloadRecipient(data: ResendEvent['data']): string | null {
  const to = data?.to
  if (Array.isArray(to) && to.length) return String(to[0])
  if (typeof to === 'string' && to) return to
  if (typeof data?.email === 'string' && data.email) return data.email
  return null
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
  // FSOS-030: prefer the echoed message id (written before the provider could call back), then
  // fall back to email_id (== stored provider_id). email_id is returned synchronously at send so
  // the email orphan window is narrow, but the echoed key removes it entirely.
  const mid = correlationIdFrom(evt.data)

  if (event) {
    try {
      const msg = (mid && (await findMessageById(mid))) || (providerId && (await findMessageByProviderId(providerId))) || null
      if (!msg) {
        // Ambiguous correlation → FAIL CLOSED (no guess) but OBSERVABLE, not a silent orphan.
        console.error('[resend] uncorrelated event', { mid: mid || null, providerId: providerId || null, type: evt.type })
      }
      const detail = evt.data?.click?.link || evt.data?.bounce?.message || null
      await recordMessageEvent({
        messageId: msg?.id ?? null,
        conversationId: msg?.conversation_id ?? null,
        campaignId: msg?.campaign_id ?? null,
        event,
        channel: 'email',
        detail,
        providerId: providerId || null,
      })

      // Deliverability suppression: a hard bounce or spam complaint suppresses the
      // recipient through the existing enforced path. Prefer the address we actually
      // sent to (comm_messages.recipient), falling back to the event payload.
      if (event === 'bounced' || event === 'complained') {
        await applyDeliverabilitySuppression({
          event,
          bounce: evt.data?.bounce ?? null,
          email: msg?.recipient ?? payloadRecipient(evt.data),
        })
      }
    } catch (err) {
      console.error('[resend] handler error:', err)
    }
  }

  return NextResponse.json({ received: true })
}
