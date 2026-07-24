import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, internalErrorResponse } from '@/lib/http'
import { unwrapOne } from '@/lib/data/query'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { buildReportSections, type ReportResultInput } from '@/lib/fna/report'
import { FnaReportPdf } from '@/lib/fna/report-pdf'
import { planTypeDef } from '@/lib/fna/plan-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/fna/plans/[id]/report/pdf — the client-facing FNA PDF, rendered
// server-side from an APPROVED version (build instruction §7). Only an APPROVED
// version is client-presentable (§4). Content comes from the pure report model,
// so the PDF matches the HTML report and the Excel package. Roles: fsa,
// licensed_staff (+ super_admin).
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  try {
    const db = getDb()
    const { data: plan, error: pErr } = await db
      .from('fna_plans')
      .select('id, plan_type, status, current_version_id, households(primary_name)')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (pErr) return internalErrorResponse(pErr.message, { label: 'fna.report.pdf' })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (plan.status !== 'APPROVED' || !plan.current_version_id) {
      return NextResponse.json({ error: 'Only an APPROVED plan can be presented to a client.' }, { status: 403 })
    }

    const { data: version } = await db.from('fna_versions').select('version_no, engine_version, assumption_set_version').eq('id', plan.current_version_id).maybeSingle()
    const { data: results } = await db.from('fna_results').select('formula_id, formula_version, envelope, confidence').eq('version_id', plan.current_version_id).order('formula_id', { ascending: true })

    const hh = unwrapOne(plan.households)
    const sections = buildReportSections((results ?? []) as ReportResultInput[])

    const buffer = await renderToBuffer(
      FnaReportPdf({
        householdName: hh?.primary_name ?? 'Household',
        planTypeLabel: planTypeDef(plan.plan_type)?.label ?? plan.plan_type,
        versionNo: version?.version_no ?? 1,
        engineVersion: version?.engine_version ?? '',
        assumptionSetVersion: version?.assumption_set_version ?? '',
        approved: true,
        sections,
      }),
    )

    await writeAudit({ actor: actorOf(auth.session), action: 'entity.viewed', entity: 'fna_version', entityId: plan.current_version_id, diff: { event: 'fna.report.exported', format: 'pdf', plan_id: params.id } })

    return new NextResponse(buffer as unknown as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="fna-${(hh?.primary_name ?? 'household').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-v${version?.version_no ?? 1}.pdf"`,
      },
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to render PDF' }, { status: 500 })
  }
}
