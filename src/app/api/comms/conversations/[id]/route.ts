import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { ConversationReplySchema, ConversationPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { sendThroughGate } from '@/lib/comms/send'
import { runIdempotent } from '@/lib/jobs/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — the full message history for one thread (marks it read).
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const { id } = await props.params
  try {
    const db = getDb()
    const { data: conv, error } = await db.from('comm_conversations').select('*').eq('id', id).maybeSingle()
    if (error) return dbErrorResponse('comms/conversations/[id]', error)
    if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { data: messages } = await db
      .from('comm_messages')
      .select('id, direction, channel, body, subject, delivery_status, blocked_step, block_reason, ai_generated, opened_at, clicked_at, delivered_at, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .limit(500)
    // Mark read on open.
    if (conv.unread_count > 0) await db.from('comm_conversations').update({ unread_count: 0 }).eq('id', id)
    return NextResponse.json({ conversation: conv, messages: messages ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// PATCH — thread settings (status, AI auto-reply toggle, assignment).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ConversationPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data, error } = await db
      .from('comm_conversations')
      .update({ ...v.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, status, ai_autoreply, assigned_user')
      .maybeSingle()
    if (error) return dbErrorResponse('comms/conversations/[id]', error)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({ actor, action: 'entity.updated', entity: 'conversation', entityId: id, diff: v.data })
    return NextResponse.json({ conversation: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST — a human reply from the FSA inbox. ALWAYS through the 7-step gate at send
// time (consent/quiet-hours/DNC/approved-template/recommendation/securities). A
// securities-flagged thread or an unconsented recipient is blocked + escalated.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ConversationReplySchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid reply', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: conv } = await db
      .from('comm_conversations')
      .select('id, channel, contact, member_id, household_id, is_security')
      .eq('id', id)
      .maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const outcome = await runIdempotent(`reply:${v.data.idempotency_key}`, 'comms.reply', async () =>
      sendThroughGate({
        channel: conv.channel,
        to: conv.contact,
        subject: v.data.subject,
        body: v.data.body,
        actor,
        memberId: conv.member_id,
        householdId: conv.household_id,
        entity: { type: 'conversation', id: conv.id },
        templateId: v.data.template_id ?? null,
        isSecurity: conv.is_security === true,
        conversationId: conv.id,
        // A licensed operator personally typed this 1:1 reply (satisfies gate step 4;
        // recommendation/securities/consent/quiet-hours/DNC still enforced).
        humanAuthored: !v.data.template_id,
      }),
    )
    if (outcome.skipped) return NextResponse.json({ ok: true, idempotent: true })
    const r = outcome.result!
    if (r.blocked) return NextResponse.json({ ok: false, blocked: true, reason: r.reason, blocked_step: r.gate.blockedStep }, { status: 200 })
    return NextResponse.json({ ok: true, sent: true, message_id: r.messageId })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to send reply' }, { status: 500 })
  }
}
