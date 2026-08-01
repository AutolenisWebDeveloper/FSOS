import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { z } from 'zod'
import { writeAudit } from '@/lib/audit/log'

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
      .select('id, user_id, verification_code, verified_at')
      .eq('id', id)
      .maybeSingle()
    if (!row || row.user_id !== actor) return NextResponse.json({ error: 'Destination not found.', reason: 'not_found' }, { status: 404 })
    if (row.verified_at) return NextResponse.json({ ok: true, already_verified: true })
    if (!row.verification_code || row.verification_code !== v.data.code) {
      return NextResponse.json({ error: 'That code is incorrect.', reason: 'bad_code' }, { status: 422 })
    }

    const { error } = await db
      .from('comms_test_recipients')
      .update({ verified_at: new Date().toISOString(), verification_code: null })
      .eq('id', id)
    if (error) return dbErrorResponse('comms/test/recipients/[id]', error)
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
    const { data: row } = await db.from('comms_test_recipients').select('id, user_id').eq('id', id).maybeSingle()
    if (!row || row.user_id !== actor) return NextResponse.json({ error: 'Destination not found.', reason: 'not_found' }, { status: 404 })
    const { error } = await db.from('comms_test_recipients').delete().eq('id', id)
    if (error) return dbErrorResponse('comms/test/recipients/[id]', error)
    await writeAudit({ actor, action: 'config.changed', entity: 'comms_test_recipient', entityId: id, diff: { deleted: true } })
    return NextResponse.json({ ok: true, deleted: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to remove destination' }, { status: 500 })
  }
}
