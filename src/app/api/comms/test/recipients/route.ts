import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { sendThroughGate } from '@/lib/comms/send'
import { adHocTemplateId } from '@/lib/comms/assets'
import { normalizeTestAddress, isValidTestAddress, makeVerificationCode } from '@/lib/comms/console'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Communications Command Console — test-recipient allowlist (spec §6/§9). A test send may
// only ever reach a VERIFIED destination the acting operator OWNS. Managing a destination
// is owner-scoped: the operator adds their own number/email, a one-time code is sent to it
// THROUGH THE PRODUCTION GATE (proving both control of the device and that the pipeline
// works), and the operator confirms the code (see [id] PATCH) before the destination can
// receive tests. Because the gate enforces consent even here, adding a destination also
// records the operator's self-consent to receive test messages on their own device — no
// bypass, no exemption (spec §0).

// GET — list the acting operator's own test destinations.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const actor = actorOf(auth.session)
    const { data, error } = await getDb()
      .from('comms_test_recipients')
      .select('id, channel, address, label, verified_at, created_at')
      .eq('user_id', actor)
      .order('created_at', { ascending: false })
    if (error) return dbErrorResponse('comms/test/recipients', error)
    return NextResponse.json({ recipients: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load test destinations' }, { status: 500 })
  }
}

const AddSchema = z.object({
  channel: z.enum(['sms', 'email']),
  address: z.string().min(3).max(240),
  label: z.string().max(120).optional(),
})

// POST — register a destination + send a verification code to it through the gate.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = AddSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid destination', details: v.error.flatten() }, { status: 400 })
  if (!isValidTestAddress(v.data.channel, v.data.address)) {
    return NextResponse.json({ error: 'That does not look like a valid ' + v.data.channel + ' address.', reason: 'invalid_address' }, { status: 422 })
  }

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const address = normalizeTestAddress(v.data.channel, v.data.address)
    const code = makeVerificationCode()

    // Upsert the (unverified) destination scoped to this operator. Re-adding an address the
    // operator already owns just refreshes the code; a different owner's row is rejected.
    const { data: existing } = await db
      .from('comms_test_recipients')
      .select('id, user_id')
      .eq('channel', v.data.channel)
      .eq('address', address)
      .maybeSingle()
    if (existing && existing.user_id !== actor) {
      return NextResponse.json({ error: 'That destination is already registered by another user.', reason: 'owned_by_other' }, { status: 409 })
    }

    let recipientId = existing?.id as string | undefined
    if (recipientId) {
      await db.from('comms_test_recipients').update({ verification_code: code, verification_sent_at: new Date().toISOString(), label: v.data.label ?? null }).eq('id', recipientId)
    } else {
      const { data: created, error } = await db
        .from('comms_test_recipients')
        .insert({ user_id: actor, channel: v.data.channel, address, label: v.data.label ?? null, verification_code: code, verification_sent_at: new Date().toISOString() })
        .select('id')
        .single()
      if (error || !created) return dbErrorResponse('comms/test/recipients', error)
      recipientId = created.id
    }

    // Record self-consent so the verification code + future tests can pass gate step 1 on
    // the operator's OWN device (comm_contact_consents — read by the gate for a contact with
    // no household member). This is legitimate: the operator is consenting for their device.
    await db.from('comm_contact_consents').insert({
      contact: address,
      channel: v.data.channel,
      action: 'granted',
      consent_text: 'Operator self-consent to receive FSOS test messages on an owned device.',
      consent_version: 'test-recipient-v1',
      source_url: '/app/comms/console',
    })

    // Send the code THROUGH THE GATE (is_test). A blocked result is still informative — it
    // proves the gate is enforcing — and the operator can address it (e.g. quiet hours).
    const templateId = await adHocTemplateId(v.data.channel)
    const outcome = await sendThroughGate({
      channel: v.data.channel,
      to: address,
      subject: v.data.channel === 'email' ? 'Your FSOS test verification code' : undefined,
      body: `Your FSOS test destination verification code is ${code}. Enter it in the console to verify this device.`,
      actor,
      templateId,
      humanAuthored: true,
      isTest: true,
      sourceKind: 'test',
    })

    await writeAudit({ actor, action: 'config.changed', entity: 'comms_test_recipient', entityId: recipientId ?? null, diff: { channel: v.data.channel, verification_sent: outcome.sent } })
    return NextResponse.json({
      ok: true,
      recipient_id: recipientId,
      code_sent: outcome.sent,
      blocked: outcome.blocked,
      reason: outcome.blocked ? outcome.reason : undefined,
      blocked_step: outcome.blocked ? outcome.gate.blockedStep : undefined,
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to add test destination' }, { status: 500 })
  }
}
