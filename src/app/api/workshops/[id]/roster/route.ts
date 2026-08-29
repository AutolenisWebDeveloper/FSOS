import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, dbErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** RFC 4180 field: quote when needed, double embedded quotes. A leading =, +, -, @ or
 *  tab is prefixed with an apostrophe so a spreadsheet cannot execute it as a formula
 *  (CSV injection — the roster carries attacker-suppliable names). */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvField).join(',')
}

// GET /api/workshops/[id]/roster — the door/reporting roster as CSV (WS-045).
// Server-generated, role-gated exactly like the workshop detail page it is reached
// from, and AUDITED: a roster is a PII export (names, emails, phones), so every
// download is attributable. Cancelled registrations are included with their status so
// the door list and the reporting list are the same document. No securities data.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const { data: workshop, error: wErr } = await db
      .from('workshops')
      .select('workshop_id, title, slug, scheduled_at')
      .eq('workshop_id', params.id)
      .maybeSingle()
    if (wErr) return dbErrorResponse('workshops/[id]/roster', wErr)
    if (!workshop) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    const { data: regs, error: rErr } = await db
      .from('workshop_registrations')
      .select(
        'reg_id, name, email, phone, status, chosen_delivery, guest_count, is_walk_in, ' +
          'lead_source, marketing_opt_in, registered_at, cancelled_at, session_id',
      )
      .eq('workshop_id', params.id)
      .order('registered_at', { ascending: true, nullsFirst: false })
    if (rErr) return dbErrorResponse('workshops/[id]/roster', rErr)
    type RosterRow = {
      reg_id: string
      name: string | null
      email: string | null
      phone: string | null
      status: string | null
      chosen_delivery: string | null
      guest_count: number | null
      is_walk_in: boolean | null
      lead_source: string | null
      marketing_opt_in: boolean | null
      registered_at: string | null
      cancelled_at: string | null
      session_id: string | null
    }
    const rows = (regs ?? []) as unknown as RosterRow[]

    // Attendance is the source of truth for who showed (WS-040); merge it in.
    const attByReg = new Map<string, string>()
    if (rows.length > 0) {
      const { data: att } = await db
        .from('workshop_attendance')
        .select('registration_id, status')
        .in('registration_id', rows.map((r) => r.reg_id))
      for (const a of (att as { registration_id: string; status: string }[]) ?? []) {
        attByReg.set(a.registration_id, a.status)
      }
    }

    const header = [
      'Name', 'Email', 'Phone', 'Registration status', 'Attendance', 'Delivery',
      'Guests', 'Walk-in', 'Marketing opt-in', 'Lead source', 'Registered at', 'Cancelled at',
    ]
    const body = rows.map((r) =>
      csvRow([
        r.name,
        r.email,
        r.phone,
        r.status,
        attByReg.get(r.reg_id) ?? 'registered',
        r.chosen_delivery,
        r.guest_count ?? 0,
        r.is_walk_in ? 'yes' : 'no',
        r.marketing_opt_in ? 'yes' : 'no',
        r.lead_source,
        r.registered_at,
        r.cancelled_at,
      ]),
    )
    const csv = [csvRow(header), ...body].join('\r\n') + '\r\n'

    await writeAudit({
      actor,
      action: 'entity.exported',
      entity: 'workshop',
      entityId: params.id,
      diff: { export: 'roster_csv', rows: rows.length },
    })

    const slug = (workshop.slug as string | null) || (workshop.workshop_id as string)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="roster-${slug}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to export roster' }, { status: 500 })
  }
}
