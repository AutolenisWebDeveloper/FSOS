import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { sendBookingConfirmation } from '@/lib/booking/notify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// FSA-initiated send of an APPROVED appointment communication (§12). This does NOT introduce a new
// send path: it re-triggers the existing approved appointment template through the ONE dispatcher
// gate (sendBookingConfirmation → sendMessage), which enforces consent, quiet hours, DNC,
// approved-template, and the securities firewall. No free-text, no AI-authored content, so there is
// no red-line surface here. A gate block is a normal outcome (returned as { sent:false, reason }),
// not a server error.

const uuid = z.string().uuid()
// Only approved, pre-existing appointment templates are selectable — extend this enum as more
// approved appointment messages are added; never accept an arbitrary body.
const SendSchema = z.object({ kind: z.enum(['confirmation']).default('confirmation') })

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const apptId = uuid.safeParse(params.id)
  if (!apptId.success) return NextResponse.json({ error: 'Invalid appointment id' }, { status: 400 })

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = SendSchema.safeParse(parsed.data ?? {})
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  try {
    const outcome = await sendBookingConfirmation(apptId.data, actorOf(auth.session))
    // 200 either way: a gate block (quiet hours / no consent / DNC / template not approved) is a
    // legitimate decision the UI surfaces — the client reads `sent`, not just the HTTP status.
    return NextResponse.json({ ok: true, kind: v.data.kind, sent: outcome.sent, reason: outcome.reason ?? null })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to send the communication' }, { status: 500 })
  }
}
