import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { WorkshopCancelSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { sendCancelAcknowledgment } from '@/lib/workshops/comms-engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUBLIC registrant self-cancel (WS-009). Token-addressed via the per-registrant
// join_token — the same manage-flow pattern as booking; never a name/email lookup, so
// nothing about other registrants can be probed. Idempotent: re-cancelling returns the
// same success. Cancelling:
//   • frees the seat + re-opens the duplicate guard (mig 128 counts exclude 'cancelled'),
//   • terminates the reminder cadence STRUCTURALLY (every engine pass filters
//     status='cancelled' — no comms flag to forget),
//   • sends the cancel_ack email through the engine's claimed path (one send path;
//     placeholder template ⇒ deferred, per D-5 — the cancellation stands regardless).
export async function POST(req: NextRequest) {
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error

  const ip = clientIp(req)
  if (!rateLimit(`workshop-cancel:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again shortly.' }, { status: 429 })
  }

  const v = WorkshopCancelSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'This cancellation link is not valid.' }, { status: 400 })
  }

  try {
    const db = getDb()
    const { data: reg, error: rErr } = await db
      .from('workshop_registrations')
      .select('reg_id, workshop_id, session_id, status, cancelled_at')
      .eq('join_token', v.data.token)
      .maybeSingle()
    if (rErr) return dbErrorResponse('public/workshops/cancel', rErr)
    if (!reg) {
      return NextResponse.json({ error: 'This cancellation link is not valid.' }, { status: 404 })
    }

    if (reg.status === 'cancelled') {
      return NextResponse.json({ ok: true, already_cancelled: true })
    }

    // A registration for a session that already started has nothing left to cancel.
    if (reg.session_id) {
      const { data: session } = await db
        .from('workshop_sessions')
        .select('starts_at')
        .eq('id', reg.session_id)
        .maybeSingle()
      if (session?.starts_at && Date.parse(session.starts_at) <= Date.now()) {
        return NextResponse.json(
          { error: 'This workshop has already taken place, so there is nothing to cancel.' },
          { status: 409 },
        )
      }
    }

    const cancelledAt = new Date().toISOString()
    const { error: uErr } = await db
      .from('workshop_registrations')
      .update({ status: 'cancelled', cancelled_at: cancelledAt })
      .eq('reg_id', reg.reg_id)
      .neq('status', 'cancelled')
    if (uErr) return dbErrorResponse('public/workshops/cancel', uErr)

    await writeAudit({
      actor: 'public:registrant',
      action: 'entity.updated',
      entity: 'workshop_registration',
      entityId: reg.reg_id,
      diff: { status: 'cancelled', cancelled_at: cancelledAt, via: 'self_cancel_link' },
    })

    // Acknowledgment through the engine's claimed path — best-effort; the cancellation
    // above is already durable and the cadence is already terminated.
    try {
      await sendCancelAcknowledgment(db, reg.reg_id)
    } catch (ackErr) {
      console.error('[workshop-cancel] cancel_ack send (non-fatal):', ackErr)
    }

    return NextResponse.json({ ok: true, cancelled: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Cancellation failed. Please try again.' }, { status: 500 })
  }
}
