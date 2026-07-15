import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { FfsContactSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Legacy-port FFS key contacts (docs/legacy-port.md §2.4). Config-driven directory
// for the sidebar QUICK ACCESS panel — never hard-coded. Super-only; every change
// audited before/after.
export async function GET() {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('ffs_contacts')
      .select('*')
      .order('sort', { ascending: true })
      .order('role', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ contacts: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Create (no id) or update (id present) a contact. Only super_admin may edit config.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('super')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = FfsContactSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid contact', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    const base = {
      role: v.data.role,
      name: v.data.name ?? null,
      phone: v.data.phone,
      hours: v.data.hours ?? null,
      note: v.data.note ?? null,
      sort: v.data.sort,
      active: v.data.active ?? true,
      updated_at: new Date().toISOString(),
    }

    let result
    let beforeRow: Record<string, unknown> | null = null
    if (v.data.id) {
      const { data: before } = await db.from('ffs_contacts').select('*').eq('id', v.data.id).maybeSingle()
      if (!before) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
      beforeRow = before
      result = await db.from('ffs_contacts').update(base).eq('id', v.data.id).select('*').single()
    } else {
      const slug = await uniqueSlug(db, slugify(v.data.role, v.data.name))
      result = await db.from('ffs_contacts').insert({ ...base, slug }).select('*').single()
    }
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })

    await writeAudit({
      actor,
      action: 'config.changed',
      entity: 'ffs_contact',
      entityId: result.data.id,
      diff: {
        before: beforeRow ? { role: beforeRow.role, name: beforeRow.name, phone: beforeRow.phone, active: beforeRow.active } : null,
        after: { role: base.role, name: base.name, phone: base.phone, active: base.active },
      },
    })
    return NextResponse.json({ contact: result.data }, { status: v.data.id ? 200 : 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to save contact' }, { status: 500 })
  }
}

function slugify(role: string, name?: string | null): string {
  const base = [role, name].filter(Boolean).join(' ')
  const s = base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\da-z]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'contact'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uniqueSlug(db: any, seed: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? seed : `${seed}-${i + 1}`
    const { data } = await db.from('ffs_contacts').select('id').eq('slug', candidate).maybeSingle()
    if (!data) return candidate
  }
  return `${seed}-${Date.now()}`
}
