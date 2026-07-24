// src/lib/fna/report.ts
// PURE report model (build instruction §7). Turns an APPROVED version's stored
// results into a flat, labeled, traceable row set shared by every output — the
// HTML report, the Excel data package, and the PDF. No I/O, no React; compiles
// standalone (tests/fna-report.test.mjs). Every figure keeps its formula id +
// version so the report is reproducible from the version.

export const REPORT_DISCLOSURE =
  'For educational and informational purposes only. Not a product recommendation or suitability determination. Requires licensed FSA review per FINRA Reg BI.'

const FORMULA_LABEL: Record<string, string> = {
  cash_flow: 'Cash flow',
  net_worth: 'Net worth',
  emergency_fund: 'Emergency fund',
  life_insurance_need: 'Life insurance need',
  coverage_gap: 'Coverage gap',
  disability_exposure: 'Disability exposure',
  retirement_projection: 'Retirement projection',
  education_funding: 'Education funding',
  survivor_income: 'Survivor income',
}

export function formulaLabel(id: string): string {
  return FORMULA_LABEL[id] ?? id
}

function humanize(k: string): string {
  return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function fmt(key: string, value: number): string {
  const k = key.toLowerCase()
  if (k.includes('ratio') || k.includes('rate') || k.includes('margin')) return `${(value * 100).toFixed(1)}%`
  if (k.includes('months') || k.includes('years') || k.includes('age')) return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export interface ReportRow {
  label: string
  value: string
}

/** Flatten one result envelope's output into labeled, formatted rows. */
export function extractReportRows(output: Record<string, unknown>): ReportRow[] {
  const rows: ReportRow[] = []
  for (const [k, v] of Object.entries(output)) {
    if (typeof v === 'number') rows.push({ label: humanize(k), value: fmt(k, v) })
    else if (typeof v === 'boolean') rows.push({ label: humanize(k), value: v ? 'Yes' : 'No' })
    else if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === 'number') rows.push({ label: `${humanize(k)} — ${humanize(k2)}`, value: fmt(k2, v2) })
      }
    }
  }
  return rows
}

export interface ReportResultInput {
  formula_id: string
  formula_version: string
  envelope: { output: Record<string, unknown>; assumptions_used?: Array<{ key: string; value: number; unit: string }>; missing_inputs?: string[] }
  confidence: string
}

export interface ReportSection {
  formulaId: string
  label: string
  version: string
  confidence: string
  rows: ReportRow[]
  assumptions: Array<{ label: string; value: string }>
  missing: string[]
}

/** Assemble the report sections (one per formula) from stored result rows. */
export function buildReportSections(results: ReportResultInput[]): ReportSection[] {
  return results.map((r) => ({
    formulaId: r.formula_id,
    label: formulaLabel(r.formula_id),
    version: r.formula_version,
    confidence: r.confidence,
    rows: extractReportRows(r.envelope.output),
    assumptions: (r.envelope.assumptions_used ?? []).map((a) => ({
      label: humanize(a.key),
      value: a.unit === 'rate' ? `${(a.value * 100).toFixed(1)}%` : a.unit === 'usd' ? a.value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : String(a.value),
    })),
    missing: r.envelope.missing_inputs ?? [],
  }))
}
