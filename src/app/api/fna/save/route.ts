import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse, internalErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { screenFnaReport, withDisclaimer } from '@/lib/fna/screen'
import { persistNarrativeSnapshot } from '@/lib/fna/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Bound + validate the report at the edge (§3.1.7 — no unvalidated write). Only the
// known NARRATIVE fields are allowed; zod strips every other key, so AI-authored
// numeric fields (key_metrics, monthly_retirement_gap) or any smuggled securities-
// substantive data (§4.1) can never reach documents.content / fna_versions.narrative.
const FnaReportSchema = z
  .object({
    executive_summary: z.string().max(4000).optional(),
    financial_position: z.string().max(8000).optional(),
    gaps: z.array(z.string().max(2000)).max(50).optional(),
    recommendations: z
      .array(
        z.object({
          priority: z.number().int().min(0).max(99).optional(),
          title: z.string().max(500).optional(),
          description: z.string().max(4000).optional(),
          // Category only — never a specific product/carrier (§1 red line).
          product_category: z.string().max(120).optional(),
        }),
      )
      .max(50)
      .optional(),
    next_steps: z.array(z.string().max(2000)).max(50).optional(),
    risk_profile: z.string().max(64).optional(),
    urgency: z.string().max(32).optional(),
    ffs_managed: z.boolean().optional(),
    compliance_disclaimer: z.string().max(1000).optional(),
  })
  .strip()

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

  const parsed = await readJson<{ household_id?: string; report?: unknown }>(req)
  if ('error' in parsed) return parsed.error
  const { household_id: householdId, report: rawReport } = parsed.data
  if (!householdId) return NextResponse.json({ error: 'household_id required' }, { status: 400 })
  const reportParse = FnaReportSchema.safeParse(rawReport)
  if (!reportParse.success) {
    return NextResponse.json({ error: 'invalid report', details: reportParse.error.flatten() }, { status: 400 })
  }

  // Force the disclaimer, then re-screen. A save can never bypass the red line.
  const report = withDisclaimer(reportParse.data)
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
    if (hhErr) return internalErrorResponse(hhErr.message, { label: 'fna.save.household' })
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
    if (docErr) return internalErrorResponse(docErr.message, { label: 'fna.save.document' })

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

    // Additionally persist a STRUCTURED FNA record (ADR-016): a plan + an immutable
    // version snapshotting this narrative + the active assumption-set. Best-effort —
    // a failure here must NEVER break the document save above (build instruction §4),
    // so it is isolated and only augments the response.
    let structured: { plan_id: string; version_id: string } | null = null
    try {
      const snap = await persistNarrativeSnapshot(householdId, report as Record<string, unknown>, actor, { title })
      if (snap.ok) {
        structured = snap.data
        await writeAudit({
          actor,
          action: 'entity.created',
          entity: 'fna_version',
          entityId: snap.data.version_id,
          diff: { event: 'fna.version.snapshot', plan_id: snap.data.plan_id, from: 'narrative_save', document_id: doc.id },
        })
      } else {
        console.error('[fna] structured snapshot skipped:', snap.message)
      }
    } catch (e) {
      console.error('[fna] structured snapshot failed (document save unaffected):', e)
    }

    return NextResponse.json({ document_id: doc.id, title, ...(structured ?? {}) }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to save FNA' }, { status: 500 })
  }
}
