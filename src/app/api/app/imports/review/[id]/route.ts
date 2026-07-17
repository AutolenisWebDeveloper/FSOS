import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { mergeFields } from '@/lib/import/resolution'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Resolve one manual-review import record: merge its data into a chosen existing
// contact, create a new contact from it, or skip it. Updates the audit record
// with the outcome (merged fields, rejected values) so the trail stays complete.
const BodySchema = z.object({
  action: z.enum(['merge', 'create', 'skip']),
  target_contact_id: z.string().uuid().optional(),
})

const MERGE_SPEC = [
  { field: 'email' }, { field: 'email_lc' }, { field: 'phone' }, { field: 'phone_digits' },
  { field: 'first_name' }, { field: 'last_name' }, { field: 'tags', kind: 'set' as const },
]

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  const { action, target_contact_id } = parsed.data

  const db = getDb()
  const actor = actorOf(auth.session)

  const { data: rec, error } = await db.from('import_records').select('*').eq('id', params.id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rec) return NextResponse.json({ error: 'Review record not found.' }, { status: 404 })
  if (rec.review_status !== 'needs_review') return NextResponse.json({ error: `Record is already ${rec.review_status}.` }, { status: 409 })

  const incoming = (rec.decision?.incoming ?? {}) as Record<string, unknown>
  const nowResolved = { review_status: 'resolved' as const, resolved_by: actor, resolved_at: new Date().toISOString() }

  try {
    if (action === 'skip') {
      await db.from('import_records').update({ review_status: 'skipped', resolved_by: actor, resolved_at: new Date().toISOString() }).eq('id', rec.id)
      return NextResponse.json({ ok: true, action })
    }

    if (action === 'merge') {
      if (!target_contact_id) return NextResponse.json({ error: 'target_contact_id is required to merge.' }, { status: 400 })
      const { data: ex } = await db.from('contacts').select('id, full_name, first_name, last_name, email, email_lc, phone, phone_digits, tags, contact_type').eq('id', target_contact_id).is('deleted_at', null).maybeSingle()
      if (!ex) return NextResponse.json({ error: 'Target contact not found.' }, { status: 404 })
      const { patch, merged, rejected } = mergeFields(ex as Record<string, unknown>, incoming, MERGE_SPEC)
      if ((ex as { contact_type?: string }).contact_type === 'unknown' && incoming.contact_type && incoming.contact_type !== 'unknown') {
        patch.contact_type = incoming.contact_type
        merged.push('contact_type')
      }
      if (Object.keys(patch).length) {
        const { error: uerr } = await db.from('contacts').update(patch).eq('id', target_contact_id).is('deleted_at', null)
        if (uerr) return NextResponse.json({ error: uerr.message }, { status: 500 })
      }
      await db.from('import_records').update({ ...nowResolved, target_id: target_contact_id, merged_fields: merged, rejected_values: rejected }).eq('id', rec.id)
      await writeAudit({ actor, action: 'entity.updated', entity: 'contact', entityId: target_contact_id, diff: { via: 'import_review_merge', merged, rejected } })
      return NextResponse.json({ ok: true, action, merged, rejected })
    }

    // create
    const insert = {
      full_name: incoming.full_name || 'Unnamed contact',
      first_name: incoming.first_name ?? null, last_name: incoming.last_name ?? null,
      email: incoming.email ?? null, email_lc: incoming.email_lc ?? null,
      phone: incoming.phone ?? null, phone_digits: incoming.phone_digits ?? null,
      contact_type: incoming.contact_type ?? 'unknown', tags: incoming.tags ?? [],
      source: incoming.source ?? 'import_review', status: 'active', created_by: actor,
      owner_scope: auth.session.userId ?? null,
    }
    const { data: created, error: cerr } = await db.from('contacts').insert(insert).select('id').single()
    if (cerr) return NextResponse.json({ error: cerr.message }, { status: 500 })
    await db.from('import_records').update({ ...nowResolved, target_id: created?.id ?? null }).eq('id', rec.id)
    await writeAudit({ actor, action: 'entity.created', entity: 'contact', entityId: created?.id ?? null, diff: { via: 'import_review_create' } })
    return NextResponse.json({ ok: true, action, contact_id: created?.id })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to resolve review record.' }, { status: 500 })
  }
}
