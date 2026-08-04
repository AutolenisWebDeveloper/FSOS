import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/*
 * Contact 360 notes for a household (redesign follow-up).
 * GET  — list live notes (optionally member-scoped via ?member=<mid>); pinned first.
 * POST — create a household- or member-level note.
 *
 * A note is internal FSA free text, NOT a communication: no dispatcher path, no
 * firewall/DOB interaction. FSA-gated; every mutation writes audit_log.
 */

const CreateSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  member_id: z.string().uuid().nullish(),
  is_pinned: z.boolean().optional().default(false),
})

const STAFF = ['fsa', 'licensed_staff', 'admin', 'super_admin'] as const

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  const memberId = req.nextUrl.searchParams.get('member')
  try {
    const db = getDb()
    let q = db
      .from('notes')
      .select('id, household_id, member_id, author_id, body, is_pinned, created_at, updated_at')
      .eq('household_id', id)
      .is('deleted_at', null)
    if (memberId) q = q.eq('member_id', memberId)
    const { data, error } = await q.order('is_pinned', { ascending: false }).order('created_at', { ascending: false })
    if (error) return dbErrorResponse('notes', error)
    return NextResponse.json({ notes: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load notes' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...STAFF])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid note', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // A member note must belong to this household (referential integrity §13.6).
    if (v.data.member_id) {
      const { data: m } = await db.from('household_members').select('id').eq('id', v.data.member_id).eq('household_id', id).is('deleted_at', null).maybeSingle()
      if (!m) return NextResponse.json({ error: 'Member is not part of this household' }, { status: 400 })
    }

    const { data, error } = await db
      .from('notes')
      .insert({ household_id: id, member_id: v.data.member_id ?? null, author_id: actor, body: v.data.body, is_pinned: v.data.is_pinned })
      .select('id, household_id, member_id, author_id, body, is_pinned, created_at, updated_at')
      .single()
    if (error) return dbErrorResponse('notes', error)

    await writeAudit({ actor, action: 'entity.created', entity: 'note', entityId: data.id, diff: { household_id: id, member_id: v.data.member_id ?? null, pinned: v.data.is_pinned } })
    return NextResponse.json({ note: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to save note' }, { status: 500 })
  }
}
