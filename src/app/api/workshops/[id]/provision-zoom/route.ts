import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { provisionZoomForRegistration } from '@/lib/workshops/server'
import { zoomEnabled } from '@/lib/zoom/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/workshops/[id]/provision-zoom — staff RETRY for per-registrant Zoom
// provisioning (spec §A "provisioned on retry, not lost"). Idempotent: registrations that
// already have a join_url are skipped. Best-effort per registration — a transient Zoom
// failure leaves that registration unprovisioned for a later retry, never blocked. Staff
// rbac, audited. No-op (clean) when Zoom credentials are not configured.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const { data: w } = await db.from('workshops').select('workshop_id').eq('workshop_id', params.id).maybeSingle()
    if (!w) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    if (!zoomEnabled()) {
      return NextResponse.json({ ok: true, zoom_enabled: false, provisioned: 0, skipped: 0, failed: 0, note: 'Zoom credentials not configured — provisioning is a no-op until ZOOM_* env vars are set.' })
    }

    // Registrations for this workshop still missing a provisioned join link.
    const { data: regs } = await db
      .from('workshop_registrations')
      .select('reg_id')
      .eq('workshop_id', params.id)
      .is('join_url', null)
    const targets = regs ?? []

    let provisioned = 0
    let skipped = 0
    let failed = 0
    for (const r of targets) {
      const res = await provisionZoomForRegistration(db, r.reg_id)
      if (!res.ok) failed++
      else if (res.skipped) skipped++
      else provisioned++
    }

    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'workshop',
      entityId: params.id,
      diff: { via: 'provision_zoom_retry', provisioned, skipped, failed },
    })

    return NextResponse.json({ ok: true, zoom_enabled: true, provisioned, skipped, failed })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Provisioning retry failed' }, { status: 500 })
  }
}
