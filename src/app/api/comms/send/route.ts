import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { sendThroughGate } from '@/lib/comms/send'
import { runIdempotent } from '@/lib/jobs/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// OS-12 one-off send (inbox reply / manual). ALWAYS through the 7-step gate at send
// time. Idempotency key prevents double-sends on retry. There is no force-send path.
const SendSchema = z.object({
  channel: z.enum(['sms', 'email']),
  to: z.string().min(3),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(4000),
  member_id: z.string().uuid().optional(),
  household_id: z.string().uuid().optional(),
  template_id: z.string().uuid(),
  entity_type: z.string().max(60).optional(),
  entity_id: z.string().uuid().optional(),
  is_security: z.boolean().optional(),
  idempotency_key: z.string().min(8).max(200),
})

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = SendSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid send', details: v.error.flatten() }, { status: 400 })

  try {
    const actor = actorOf(auth.session)
    const outcome = await runIdempotent(`send:${v.data.idempotency_key}`, 'comms.send', async () =>
      sendThroughGate({
        channel: v.data.channel,
        to: v.data.to,
        subject: v.data.subject,
        body: v.data.body,
        actor,
        memberId: v.data.member_id ?? null,
        householdId: v.data.household_id ?? null,
        entity: v.data.entity_type && v.data.entity_id ? { type: v.data.entity_type, id: v.data.entity_id } : undefined,
        templateId: v.data.template_id,
        isSecurity: v.data.is_security === true,
      }),
    )
    if (outcome.skipped) return NextResponse.json({ ok: true, idempotent: true })
    const r = outcome.result!
    if (r.blocked) return NextResponse.json({ ok: false, blocked: true, reason: r.reason, blocked_step: r.gate.blockedStep }, { status: 200 })
    return NextResponse.json({ ok: true, sent: true, message_id: r.messageId })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
