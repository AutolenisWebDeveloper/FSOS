import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { screenFnaReport, withDisclaimer, type FnaReport } from '@/lib/fna/screen'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Save a reviewed FNA to Document OS (classification 'fna_report') + an activity
// on the household (docs/legacy-port.md §2.1: "report saved as a document, not
// emailed ad hoc"). The report is re-screened server-side (defense in depth):
// a recommendation-bearing or disclaimer-missing report is refused, never stored.
// Audits document.created. Roles: fsa, licensed_staff (+ super_admin).
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson<{ household_id?: string; report?: FnaReport }>(req)
  if ('error' in parsed) return parsed.error
  const { household_id: householdId, report: rawReport } = parsed.data
  if (!householdId) return NextResponse.json({ error: 'household_id required' }, { status: 400 })
  if (!rawReport || typeof rawReport !== 'object') {
    return NextResponse.json({ error: 'report required' }, { status: 400 })
  }

  // Force the disclaimer, then re-screen. A save can never bypass the red line.
  const report = withDisclaimer(rawReport)
  const screen = screenFnaReport(report)
  if (!screen.allow) {
    return NextResponse.json({ blocked: true, reasons: screen.reasons }, { status: 422 })
  }

  const actor = actorOf(auth.session)

  try {
    const db = getDb()

    const { data: hh, error: hhErr } = await db
      .from('households')
      .select('id, primary_name')
      .eq('id', householdId)
      .is('deleted_at', null)
      .maybeSingle()
    if (hhErr) return NextResponse.json({ error: hhErr.message }, { status: 500 })
    if (!hh) return NextResponse.json({ error: 'Household not found' }, { status: 404 })

    const title = `Financial Needs Analysis — ${hh.primary_name}`
    const nowIso = new Date().toISOString()

    const { data: doc, error: docErr } = await db
      .from('documents')
      .insert({
        entity_type: 'household',
        entity_id: householdId,
        classification: 'fna_report',
        title,
        content: report,
        file_name: 'fna-report.json',
        mime_type: 'application/json',
        uploaded_by: actor,
        scan_status: 'clean',
        version: 1,
        updated_at: nowIso,
      })
      .select('id')
      .single()
    if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 })

    await db.from('activities').insert({
      entity_type: 'household',
      entity_id: householdId,
      kind: 'fna_report',
      note: `FNA generated and saved to Document OS (urgency ${String(report.urgency ?? 'n/a')}).`,
      actor,
    })

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'document',
      entityId: doc.id,
      diff: { event: 'document.created', classification: 'fna_report', household_id: householdId },
    })

    return NextResponse.json({ document_id: doc.id, title }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to save FNA' }, { status: 500 })
  }
}
