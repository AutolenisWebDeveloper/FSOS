import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { buildReportSections, REPORT_DISCLOSURE, type ReportResultInput } from '@/lib/fna/report'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/fna/plans/[id]/report/xlsx — the internal / compliance data package for
// an APPROVED version (build instruction §7). Reproducible: every figure carries
// its formula + version + assumptions + confidence. Reuses exceljs (no new dep).
// Only an APPROVED version exports (§4). Roles: fsa, licensed_staff (+ super_admin).
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
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (plan.status !== 'APPROVED' || !plan.current_version_id) {
      return NextResponse.json({ error: 'Only an APPROVED plan can be exported.' }, { status: 403 })
    }

    const { data: version } = await db.from('fna_versions').select('version_no, engine_version, assumption_set_version, created_at').eq('id', plan.current_version_id).maybeSingle()
    const { data: results } = await db.from('fna_results').select('formula_id, formula_version, envelope, confidence').eq('version_id', plan.current_version_id).order('formula_id', { ascending: true })

    const hh = Array.isArray(plan.households) ? plan.households[0] : plan.households
    const sections = buildReportSections((results ?? []) as ReportResultInput[])

    const wb = new ExcelJS.Workbook()
    wb.creator = 'FSOS'
    const meta = wb.addWorksheet('Summary')
    meta.columns = [{ width: 34 }, { width: 44 }]
    meta.addRows([
      ['Financial Needs Analysis', ''],
      ['Household', hh?.primary_name ?? ''],
      ['Plan type', plan.plan_type],
      ['Version', version ? `v${version.version_no}` : ''],
      ['Engine version', version?.engine_version ?? ''],
      ['Assumption set', version?.assumption_set_version ?? ''],
      ['Status', plan.status],
      ['Disclosure', REPORT_DISCLOSURE],
    ])
    meta.getRow(1).font = { bold: true, size: 14 }

    const sheet = wb.addWorksheet('Results')
    sheet.columns = [
      { header: 'Analysis', key: 'a', width: 26 },
      { header: 'Metric', key: 'm', width: 34 },
      { header: 'Value', key: 'v', width: 18 },
      { header: 'Formula', key: 'f', width: 24 },
      { header: 'Confidence', key: 'c', width: 14 },
    ]
    sheet.getRow(1).font = { bold: true }
    for (const s of sections) {
      for (const row of s.rows) {
        sheet.addRow({ a: s.label, m: row.label, v: row.value, f: `${s.formulaId}@${s.version}`, c: s.confidence })
      }
    }

    const buffer = await wb.xlsx.writeBuffer()
    await writeAudit({ actor: actorOf(auth.session), action: 'entity.viewed', entity: 'fna_version', entityId: plan.current_version_id, diff: { event: 'fna.report.exported', format: 'xlsx', plan_id: params.id } })

    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="fna-${(hh?.primary_name ?? 'household').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-v${version?.version_no ?? 1}.xlsx"`,
      },
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to export' }, { status: 500 })
  }
}
