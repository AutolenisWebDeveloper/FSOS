import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, readJson } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { RightbridgeIngestSchema } from '@/lib/validation/schemas'
import { GatewayDisabledError } from '@/lib/ai/gateway'
import { GROUNDING_SYSTEM, renderChunks, retrieveChunks, runJson } from '@/lib/compliance/intelligence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — RightBridge ingestion + consistency (blueprint §4.1,
// Prompt 4). Accepts the report's extracted TEXT (paste, or client-side PDF text),
// extracts structured fields + scoring flags, and cross-checks them against the
// case notes / other reports on the same case for the classic contradictions
// (Aggressive-vs-Moderate risk, IVA "No" while exiting a segment pre-maturity,
// premium ≠ 1035 transfer, loan blank in a structured field, unresolved caution/red).
// Grounds each consistency flag in the relevant data-integrity / limited-protection
// passage — no invented rule numbers.

const WRITE_ROLES = ['fsa', 'licensed_staff', 'super_admin'] as const

interface Extracted {
  parsed_fields?: Record<string, unknown>
  scoring_flags?: Record<string, unknown>
  consistency_flags?: { field: string; issue: string; citation?: string | null }[]
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req, 2_000_000)
  if ('error' in parsed) return parsed.error
  const v = RightbridgeIngestSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })
  }
  const d = v.data

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // Prior context on the same case (notes + other reports) for consistency.
    let caseContext = ''
    if (d.case_id) {
      const [{ data: caseRow }, { data: priorReports }, { data: issues }] = await Promise.all([
        db.from('nigo_cases').select('raw_nigo_text, product, carrier').eq('id', d.case_id).maybeSingle(),
        db.from('rightbridge_reports').select('report_type, parsed_fields').eq('case_id', d.case_id).limit(5),
        db.from('nigo_issues').select('issue_text, what_to_fix').eq('case_id', d.case_id).limit(20),
      ])
      if (caseRow) caseContext += `Case NIGO text:\n${caseRow.raw_nigo_text}\n`
      if (priorReports?.length) caseContext += `\nPrior report fields:\n${JSON.stringify(priorReports)}\n`
      if (issues?.length) caseContext += `\nOpen issues:\n${JSON.stringify(issues)}\n`
    }

    // Governing passages for the consistency dimension (data integrity + buffers).
    const chunks = await retrieveChunks(
      'data integrity risk tolerance IVA MVA buffered limited protection surrender premium 1035 loan share class liquidity consistency',
      { limit: 8 },
    )

    const system = GROUNDING_SYSTEM
    const user = [
      'Extract structured data from this RightBridge report text, then run a consistency check.',
      `REPORT TYPE: ${d.report_type}`,
      '',
      'REPORT TEXT:',
      `"""${d.report_text}"""`,
      caseContext ? `\nOTHER DOCUMENTS ON THIS CASE (check the report against these):\n${caseContext}` : '',
      '',
      'GOVERNING PASSAGES (cite these on consistency flags; do not invent rule numbers):',
      renderChunks(chunks),
      '',
      'Return ONLY this JSON:',
      '{',
      '  "parsed_fields": { "risk_tolerance": "...", "objective": "...", "funding_source": "...", "premium": "...", "face_amount": "...", "mva_iva": "...", "replacement": "...", "loan": "...", "share_class": "...", "surrender": "..." },',
      '  "scoring_flags": { "<axis>": "green|yellow|red" },',
      '  "consistency_flags": [{ "field": "...", "issue": "the contradiction, specifically", "citation": "section_ref from a passage above or null" }]',
      '}',
      '',
      'Focus consistency on: risk-tolerance mismatch across documents; MVA/IVA answered No while a segment is exited pre-maturity; premium not equal to the 1035 transfer amount; loan blank in a structured field; any RightBridge caution/red left unresolved. Only report a contradiction you can see in the text; do not speculate.',
    ]
      .filter(Boolean)
      .join('\n')

    const out = await runJson<Extracted>(system, user, 3000)
    const parsed_fields = out?.parsed_fields ?? {}
    const scoring_flags = out?.scoring_flags ?? {}
    const consistency_flags = Array.isArray(out?.consistency_flags) ? out!.consistency_flags : []

    const { data: report, error: insErr } = await db
      .from('rightbridge_reports')
      .insert({
        case_id: d.case_id ?? null,
        report_type: d.report_type,
        title: d.title ?? null,
        parsed_fields,
        scoring_flags,
        consistency_flags,
        raw_text: d.report_text.slice(0, 200_000),
        source: 'upload',
        created_by: actor,
      })
      .select('id')
      .single()
    if (insErr || !report) {
      return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 })
    }

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'rightbridge_report',
      entityId: report.id,
      diff: { report_type: d.report_type, flags: consistency_flags.length },
    })

    return NextResponse.json({
      report_id: report.id,
      parsed_fields,
      scoring_flags,
      consistency_flags,
    })
  } catch (e) {
    if (e instanceof GatewayDisabledError) {
      return NextResponse.json({ error: e.message, code: 'ai_disabled' }, { status: 503 })
    }
    return configErrorResponse(e) ?? NextResponse.json({ error: 'RightBridge parse failed' }, { status: 500 })
  }
}
