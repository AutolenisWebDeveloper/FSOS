import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { clientIp } from '@/lib/http/rate-limit'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkshopCheckInSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'
import { checkInByToken, addWalkIn } from '@/lib/workshops/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/workshops/[id]/check-in — staff kiosk actions (spec §5). Two shapes:
//   { join_token } → idempotent check-in of a known registrant (double-scan = no-op).
//   { walk_in }    → add a walk-in (creates a registration + 'attended' attendance row,
//                    captures consent + durable consent evidence the same way public
//                    registration does).
// Designed for spotty venue wifi: the client posts optimistically and safely retries; the
// server write is idempotent so a retry never double-counts or loses data. Staff rbac
// (fsa/licensed_staff/super_admin — the /app portal scope). Audited.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WorkshopCheckInSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid check-in', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  const ip = clientIp(req)
  const userAgent = req.headers.get('user-agent')?.slice(0, 400) ?? null

  try {
    const db = getDb()

    // Confirm the workshop exists (and resolve the approved disclosure for walk-in consent).
    const { data: w, error: wErr } = await db
      .from('workshops')
      .select('workshop_id, disclosure_config_id')
      .eq('workshop_id', params.id)
      .maybeSingle()
    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })
    if (!w) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    // ── Check-in by token (idempotent). ──
    if (v.data.join_token) {
      const res = await checkInByToken(db, params.id, v.data.join_token)
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
      if (!res.noop) {
        await writeAudit({
          actor,
          action: 'entity.updated',
          entity: 'workshop_attendance',
          entityId: res.registration_id,
          diff: { via: 'checkin', status: 'attended' },
        })
      }
      return NextResponse.json({ ok: true, noop: res.noop, registration_id: res.registration_id })
    }

    // ── Walk-in add. ──
    const walk = v.data.walk_in!
    // Resolve the approved disclosure text shown (evidence) — mirror the public route.
    let disclosureText = 'Educational event — no product recommendation.'
    let disclosureVersion = 'none'
    if (w.disclosure_config_id) {
      const { data: d } = await db
        .from('workshop_disclosure_configs')
        .select('kind, version, body, is_assumption')
        .eq('id', w.disclosure_config_id)
        .maybeSingle()
      if (d && d.is_assumption === false) {
        disclosureText = d.body
        disclosureVersion = `${d.kind} v${d.version}`
      }
    }

    const res = await addWalkIn(
      db,
      params.id,
      {
        name: walk.name,
        email: walk.email || null,
        phone: walk.phone ?? null,
        chosen_delivery: walk.chosen_delivery,
        consent_email: walk.consent_email,
        consent_sms: walk.consent_sms,
        session_id: walk.session_id,
      },
      { ip, userAgent, disclosureText, disclosureVersion },
    )

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'workshop_registration',
      entityId: res.registration_id,
      diff: { source: 'walk-in', workshop_id: params.id },
    })
    return NextResponse.json({ ok: true, registration_id: res.registration_id, walk_in: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Check-in failed' }, { status: 500 })
  }
}
