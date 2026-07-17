import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { ContactPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { emailLc, phoneDigits, deriveFullName } from '@/lib/contacts/normalize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Update a contact (fields / type / tags / archive). RBAC-gated + audited.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ContactPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: existing } = await db
      .from('contacts')
      .select('id, first_name, last_name, full_name, email, phone')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    const d = v.data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {}
    for (const k of ['first_name', 'last_name', 'company', 'title', 'contact_type', 'tags', 'city', 'state', 'zip', 'notes', 'household_id', 'agency_partnership_id'] as const) {
      if (d[k] !== undefined) updates[k] = d[k]
    }
    if (d.email !== undefined) {
      updates.email = d.email ?? null
      updates.email_lc = emailLc(d.email)
    }
    if (d.phone !== undefined) {
      updates.phone = d.phone ?? null
      updates.phone_digits = phoneDigits(d.phone)
    }
    if (d.full_name !== undefined) updates.full_name = d.full_name
    // Keep the display name coherent if name parts changed without an explicit full_name.
    if (d.full_name === undefined && (d.first_name !== undefined || d.last_name !== undefined)) {
      updates.full_name = deriveFullName({
        first: d.first_name ?? existing.first_name,
        last: d.last_name ?? existing.last_name,
        full: existing.full_name,
        email: d.email ?? existing.email,
        phone: d.phone ?? existing.phone,
      })
    }
    if (d.status !== undefined) {
      updates.status = d.status
      updates.archived_at = d.status === 'archived' ? new Date().toISOString() : null
    }

    const { error } = await db.from('contacts').update(updates).eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({ actor, action: 'entity.updated', entity: 'contact', entityId: params.id, diff: updates })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update contact' }, { status: 500 })
  }
}

// Soft-delete a contact.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const { data: existing } = await db.from('contacts').select('id').eq('id', params.id).is('deleted_at', null).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    const { error } = await db.from('contacts').update({ deleted_at: new Date().toISOString() }).eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({ actor, action: 'entity.deleted', entity: 'contact', entityId: params.id, diff: null })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 })
  }
}
