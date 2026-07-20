import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { verifyZoomSignature, zoomCrcResponse } from '@/lib/zoom/webhook'
import { parseZoomParticipantEvent, ZOOM_CRC_EVENT } from '@/lib/workshops/delivery'
import {
  resolveWebhookTarget,
  applyWebhookAttendance,
  getLeftEarlyThresholdMinutes,
} from '@/lib/workshops/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/zoom  (spec §B — Zoom attendance webhook; retires P1 manual marking,
// coexists with it). Verifies BOTH gates per Zoom's documented scheme:
//   1. URL-validation (CRC) on subscription: reply { plainToken, encryptedToken } where
//      encryptedToken = HMAC-SHA256(ZOOM_WEBHOOK_SECRET_TOKEN, plainToken) hex, within 3s.
//   2. Every event: x-zm-signature = "v0=" + HMAC-SHA256(secret, `v0:{ts}:{rawBody}`); reject
//      unsigned / bad-HMAC (401).
//
// On meeting/webinar participant_joined/_left it correlates by the STORED registrant token
// (never name — §5), writes/merges ONE workshop_attendance row per (registration, session)
// with capture_method='webhook', computes duration, and derives left_early against the
// config threshold. IDEMPOTENT (duplicate/reconnect events converge) and MANUAL-PRECEDENCE
// aware (a staff manual mark is never clobbered by a late webhook — see
// deriveWebhookAttendance). Service-role/verified-only — NOT an anon-writable surface.
//
// Returns 200 on handler errors (logged) to avoid Zoom retry-storms; only bad
// signature/JSON return non-200.

const TOLERANCE_SECONDS = 300

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let evt: any
  try {
    evt = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const secretConfigured = !!process.env.ZOOM_WEBHOOK_SECRET_TOKEN

  // ── 1. CRC / URL-validation challenge ──────────────────────────────────────
  if (evt?.event === ZOOM_CRC_EVENT) {
    const plainToken = evt?.payload?.plainToken
    const resp = typeof plainToken === 'string' ? zoomCrcResponse(plainToken) : null
    if (!resp) {
      // No secret configured (or malformed) — an unconfigured endpoint must not validate.
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 })
    }
    return NextResponse.json(resp, { status: 200 })
  }

  // ── 2. HMAC signature verification on every event ─────────────────────────
  const signature = req.headers.get('x-zm-signature')
  const timestamp = req.headers.get('x-zm-request-timestamp')
  if (secretConfigured) {
    const verified = verifyZoomSignature({ rawBody, signature, timestamp, toleranceSeconds: TOLERANCE_SECONDS })
    if (!verified) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  } else if (process.env.NODE_ENV === 'production') {
    // Fail-closed in production; only local/dev may run without a secret.
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 401 })
  }

  const parsed = parseZoomParticipantEvent(evt)
  if (parsed.action === 'other') {
    // Not a participant join/leave — acknowledged and ignored.
    return NextResponse.json({ received: true, ignored: true })
  }

  try {
    const db = getDb()
    const target = await resolveWebhookTarget(db, parsed)
    if (!target) {
      // Could not correlate to a registration (unknown meeting / registrant). Ack + log.
      console.log('[zoom] participant event not correlated:', parsed.meetingId, parsed.action)
      return NextResponse.json({ received: true, correlated: false })
    }

    const threshold = await getLeftEarlyThresholdMinutes(db)
    const outcome = await applyWebhookAttendance(db, target, parsed, threshold)

    if (outcome.action === 'write') {
      await writeAudit({
        actor: 'zoom_webhook',
        action: 'entity.updated',
        entity: 'workshop_attendance',
        entityId: target.registrationId,
        diff: { via: 'zoom_webhook', event: parsed.action, status: outcome.status, capture_method: 'webhook' },
      })
    } else if (outcome.reason === 'manual_precedence') {
      // Record that a webhook event yielded to a staff manual correction (precedence proof).
      await writeAudit({
        actor: 'zoom_webhook',
        action: 'entity.updated',
        entity: 'workshop_attendance',
        entityId: target.registrationId,
        diff: { via: 'zoom_webhook', event: parsed.action, skipped: 'manual_precedence' },
      })
    }

    return NextResponse.json({ received: true, outcome })
  } catch (err) {
    console.error('[zoom] webhook handler error:', err)
    return NextResponse.json({ received: true, error: 'Handler error logged' })
  }
}
