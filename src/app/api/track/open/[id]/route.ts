import { NextRequest, NextResponse } from 'next/server'
import { TRACKING_PIXEL } from '@/lib/comms/tracking'
import { recordMessageEvent } from '@/lib/comms/events'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/track/open/<messageId>
// Open-tracking pixel for an outbound email. Records an "opened" event on the
// message (first open sets opened_at) and always returns a 1×1 GIF so the email
// renders normally regardless of tracking success. Public by design (email clients
// load it), and it only touches telemetry — never message content or consent.

function gif(): NextResponse {
  return new NextResponse(TRACKING_PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Content-Length': String(TRACKING_PIXEL.length),
    },
  })
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    try {
      const { data } = await getDb()
        .from('comm_messages')
        .select('id, conversation_id, campaign_id')
        .eq('id', id)
        .maybeSingle()
      if (data) {
        await recordMessageEvent({
          messageId: data.id,
          conversationId: data.conversation_id,
          campaignId: data.campaign_id,
          event: 'opened',
          channel: 'email',
        })
      }
    } catch {
      /* pixel must render regardless */
    }
  }
  return gif()
}
