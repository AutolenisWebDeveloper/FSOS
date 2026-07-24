import { NextRequest, NextResponse } from 'next/server'
import { safeRedirectTarget } from '@/lib/comms/tracking'
import { recordMessageEvent } from '@/lib/comms/events'
import { getDb } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/track/click/<messageId>?u=<encoded destination>
// Click-tracking redirector for links in an outbound email. Records a "clicked"
// event, then 302-redirects to the validated http(s) destination. The target is
// validated (safeRedirectTarget) so this cannot be abused as an open redirect to a
// non-web scheme. If the destination is missing/invalid we return 400 rather than
// redirecting anywhere unsafe.

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  // The target must carry a valid HMAC signature bound to this message id (when a
  // signing secret is configured) — otherwise the redirector would be an open proxy.
  const target = safeRedirectTarget(req.nextUrl.searchParams.get('u'), {
    messageId: id,
    sig: req.nextUrl.searchParams.get('s'),
  })
  if (!target) return NextResponse.json({ error: 'Invalid link' }, { status: 400 })

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
          event: 'clicked',
          channel: 'email',
          detail: target.slice(0, 500),
        })
      }
    } catch {
      /* redirect regardless of telemetry success */
    }
  }

  return NextResponse.redirect(target, 302)
}
