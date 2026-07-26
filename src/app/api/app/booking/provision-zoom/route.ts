import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { zoomEnabled, createZoomMeeting } from '@/lib/zoom/client'
import { unwrapOne } from '@/lib/data/query'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BATCH = 100

// POST /api/app/booking/provision-zoom — staff RETRY for video appointments whose Zoom
// meeting wasn't created at booking time (Zoom was unconfigured or the API failed). Mirrors
// the workshop provision-zoom retry: idempotent (skips rows that already have a join_url),
// best-effort per row, clean no-op when Zoom isn't configured. FSA rbac, audited. Never logs
// or returns the FSA-only start_url.
export async function POST(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const actor = actorOf(auth.session)
  try {
    if (!zoomEnabled()) {
      return NextResponse.json({
        ok: true,
        zoom_enabled: false,
        provisioned: 0,
        skipped: 0,
        failed: 0,
        note: 'Zoom credentials not configured — provisioning is a no-op until ZOOM_* env vars are set.',
      })
    }

    const db = getDb()
    const nowIso = new Date().toISOString()
    const { data: rows } = await db
      .from('appointments')
      .select('id, starts_at, duration_minutes, booker_timezone, appointment_types(name)')
      .eq('meeting_mode', 'video')
      .eq('status', 'scheduled')
      .is('join_url', null)
      .gt('starts_at', nowIso)
      .order('starts_at', { ascending: true })
      .limit(MAX_BATCH)
    const targets = rows ?? []

    let provisioned = 0
    let failed = 0
    for (const r of targets) {
      const typeRel = unwrapOne<{ name: string | null }>(
        (r as { appointment_types?: { name: string | null } | { name: string | null }[] }).appointment_types,
      )
      const meeting = await createZoomMeeting({
        topic: typeRel?.name || 'Appointment',
        startTime: r.starts_at as string,
        durationMinutes: (r.duration_minutes as number) || 30,
        timezone: (r.booker_timezone as string) || 'UTC',
      })
      if (!meeting.ok) {
        failed++
        continue
      }
      await db
        .from('appointments')
        .update({
          zoom_meeting_id: meeting.meetingId,
          join_url: meeting.joinUrl,
          start_url: meeting.startUrl, // FSA-only; never returned below
          dial_in: meeting.dialIn,
          updated_at: new Date().toISOString(),
        })
        .eq('id', r.id)
      provisioned++
    }

    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'appointment',
      diff: { via: 'booking_provision_zoom_retry', provisioned, failed, considered: targets.length },
    })

    return NextResponse.json({ ok: true, zoom_enabled: true, provisioned, failed, considered: targets.length })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Provisioning retry failed' }, { status: 500 })
  }
}
