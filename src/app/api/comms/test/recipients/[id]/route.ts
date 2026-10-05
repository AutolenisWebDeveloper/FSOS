import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { writeAudit } from '@/lib/audit/log'
import { checkVerification, TEST_RECIPIENT_CONSENT_VERSION } from '@/lib/comms/console'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Communications Command Console — verify or remove a test destination (spec §6/§9).
// Strictly owner-scoped: an operator may only verify/delete a destination they own. A
// destination becomes usable for test sends ONLY after the correct one-time code is
// confirmed here (isTestRecipientUsable then reads verified_at).

const VerifySchema = z.object({ code: z.string().trim().min(4).max(10) })

// PATCH — confirm the verification code, marking the destination verified.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = VerifySchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid code', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: row } = await db
      .from('comms_test_recipients')
      .select('id, user_id, channel, address, verification_code, verified_at')
      .eq('id', id)
      .maybeSingle()
    if (!row || row.user_id !== actor) return NextResponse.json({ error: 'Destination not found.', reason: 'not_found' }, { status: 404 })
    if (row.verified_at) {
      // Repair path (CodeRabbit review of R4): a verification whose grant write failed (and whose
      // claim could not be reverted) is completed here, so it is never stuck verified-without-grant.
      const { data: last, error: lastErr } = await db
        .from('comm_contact_consents')
        .select('action, captured_at')
        .eq('contact', row.address)
        .eq('channel', row.channel)
        .eq('consent_version', TEST_RECIPIENT_CONSENT_VERSION)
        .order('captured_at', { ascending: false })
        .limit(1)
      if (lastErr) return dbErrorResponse('comms/test/recipients/[id]', lastErr)
      const latest = Array.isArray(last) ? (last[0] as { action?: string } | undefined) : undefined
      if (latest?.action !== 'granted') {
        const { error: repairErr } = await db.from('comm_contact_consents').insert({
          contact: row.address,
          channel: row.channel,
          action: 'granted',
          consent_text: 'Operator self-consent to receive FSOS test messages on an owned, verified device.',
          consent_version: TEST_RECIPIENT_CONSENT_VERSION,
          source_url: '/app/comms/console',
        })
        if (repairErr) return dbErrorResponse('comms/test/recipients/[id]', repairErr)
      }
      return NextResponse.json({ ok: true, already_verified: true })
    }
    const check = checkVerification(row.verification_code, v.data.code)
    // Every write below is a compare-and-set on the stored state this request judged, so concurrent
    // guesses are each counted and only one can verify (CodeRabbit review of R4). A request that
    // loses the race is told to retry and learns nothing about its guess.
    const raced = () => NextResponse.json({ error: 'Another attempt was in progress. Try again.', reason: 'retry' }, { status: 409 })
    if (!check.ok) {
      // Record the wrong guess; a burned code must be re-sent (follow-up R4).
      const { data: counted, error: guessErr } = await db
        .from('comms_test_recipients')
        .update({ verification_code: check.next })
        .eq('id', id)
        .eq('verification_code', row.verification_code)
        .select('id')
      if (guessErr) return dbErrorResponse('comms/test/recipients/[id]', guessErr)
      if (!Array.isArray(counted) || counted.length === 0) return raced()
      return check.exhausted
        ? NextResponse.json({ error: 'Too many wrong codes. Remove and re-add the destination to get a new one.', reason: 'code_exhausted' }, { status: 429 })
        : NextResponse.json({ error: 'That code is incorrect.', reason: 'bad_code' }, { status: 422 })
    }

    // Claim the verification first (compare-and-set), so a concurrent wrong guess cannot be lost and
    // only one request records the grant.
    const verifiedAt = new Date().toISOString()
    const { data: claimed, error } = await db
      .from('comms_test_recipients')
      .update({ verified_at: verifiedAt, verification_code: null })
      .eq('id', id)
      .eq('verification_code', row.verification_code)
      .is('verified_at', null)
      .select('id')
    if (error) return dbErrorResponse('comms/test/recipients/[id]', error)
    if (!Array.isArray(claimed) || claimed.length === 0) return raced()

    // The operator's self-consent for THIS device, recorded only now that they proved they hold it.
    // It counts only for TEST sends (contact-consent-read.ts) and is never START evidence (inbound.ts).
    const { error: grantErr } = await db.from('comm_contact_consents').insert({
      contact: row.address,
      channel: row.channel,
      action: 'granted',
      consent_text: 'Operator self-consent to receive FSOS test messages on an owned, verified device.',
      consent_version: TEST_RECIPIENT_CONSENT_VERSION,
      source_url: '/app/comms/console',
    })
    if (grantErr) {
      // No grant recorded → the destination is not verified (best-effort revert of the claim).
      await db.from('comms_test_recipients').update({ verified_at: null, verification_code: row.verification_code }).eq('id', id).eq('verified_at', verifiedAt)
      return dbErrorResponse('comms/test/recipients/[id]', grantErr)
    }
    await writeAudit({ actor, action: 'config.changed', entity: 'comms_test_recipient', entityId: id, diff: { verified: true } })
    return NextResponse.json({ ok: true, verified: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to verify destination' }, { status: 500 })
  }
}

// DELETE — remove an owned test destination.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: row } = await db.from('comms_test_recipients').select('id, user_id, channel, address, verified_at').eq('id', id).maybeSingle()
    if (!row || row.user_id !== actor) return NextResponse.json({ error: 'Destination not found.', reason: 'not_found' }, { status: 404 })
    // Withdraw the self-consent first (follow-up R4): append a revoke, never delete the grant.
    // Only a VERIFIED destination ever had a grant, so only it gets a revoke (CodeRabbit review of R4).
    if (row.verified_at && row.address && row.channel) {
      const { error: revokeErr } = await db.from('comm_contact_consents').insert({
        contact: row.address,
        channel: row.channel,
        action: 'revoked',
        consent_text: 'Test destination removed by its operator.',
        consent_version: TEST_RECIPIENT_CONSENT_VERSION,
        source_url: '/app/comms/console',
      })
      if (revokeErr) return dbErrorResponse('comms/test/recipients/[id]', revokeErr)
    }
    const { error } = await db.from('comms_test_recipients').delete().eq('id', id)
    if (error) return dbErrorResponse('comms/test/recipients/[id]', error)
    await writeAudit({ actor, action: 'config.changed', entity: 'comms_test_recipient', entityId: id, diff: { deleted: true } })
    return NextResponse.json({ ok: true, deleted: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to remove destination' }, { status: 500 })
  }
}
