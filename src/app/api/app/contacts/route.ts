import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { ContactCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { emailLc, phoneDigits, deriveFullName } from '@/lib/contacts/normalize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Contact Center — search existing contacts (typeahead). RBAC-gated; read-only.
// `?q=` matches full_name / email (case-insensitive). Reused by the social
// engagement review queue to resolve an author to an EXISTING contact.
export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ contacts: [] }, { status: 200 })
  const like = `%${q.replace(/[%_,]/g, '')}%`
  try {
    const { data, error } = await getDb()
      .from('contacts')
      .select('id, full_name, email, phone')
      .or(`full_name.ilike.${like},email.ilike.${like}`)
      .is('deleted_at', null)
      .order('full_name', { ascending: true })
      .limit(10)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ contacts: data ?? [] }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}

// Contact Center — manually add a contact, stored natively in App B. RBAC-gated +
// audited. Duplicate detection: a matching email/phone returns 409 with the
// existing contact unless `force: true` is passed (the UI offers "add anyway").
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<Record<string, unknown> & { force?: boolean }>(req)
  if ('error' in parsed) return parsed.error
  const force = parsed.data.force === true
  const v = ContactCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const eLc = emailLc(v.data.email)
    const pDigits = phoneDigits(v.data.phone)

    // Duplicate detection on normalized email / phone.
    if ((eLc || pDigits) && !force) {
      const or: string[] = []
      if (eLc) or.push(`email_lc.eq.${eLc}`)
      if (pDigits) or.push(`phone_digits.eq.${pDigits}`)
      const { data: dupe } = await db
        .from('contacts')
        .select('id, full_name, email, phone')
        .or(or.join(','))
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (dupe) {
        return NextResponse.json({ error: 'A contact with this email or phone already exists.', reason: 'duplicate', duplicate: dupe }, { status: 409 })
      }
    }

    const fullName = deriveFullName({ first: v.data.first_name, last: v.data.last_name, full: v.data.full_name, email: v.data.email, phone: v.data.phone })

    const { data: row, error } = await db
      .from('contacts')
      .insert({
        first_name: v.data.first_name ?? null,
        last_name: v.data.last_name ?? null,
        full_name: fullName,
        email: v.data.email ?? null,
        email_lc: eLc,
        phone: v.data.phone ?? null,
        phone_digits: pDigits,
        company: v.data.company ?? null,
        title: v.data.title ?? null,
        contact_type: v.data.contact_type,
        tags: v.data.tags ?? [],
        source: v.data.source ?? 'manual',
        household_id: v.data.household_id ?? null,
        agency_partnership_id: v.data.agency_partnership_id ?? null,
        city: v.data.city ?? null,
        state: v.data.state ?? null,
        zip: v.data.zip ?? null,
        notes: v.data.notes ?? null,
        owner_scope: auth.session.userId ?? null,
        created_by: actor,
      })
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit({ actor, action: 'entity.created', entity: 'contact', entityId: row?.id ?? null, diff: { contact_type: v.data.contact_type, source: v.data.source ?? 'manual' } })
    return NextResponse.json({ ok: true, id: row?.id ?? null })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
  }
}
