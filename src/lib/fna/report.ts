// src/lib/fna/report.ts
// PURE report model (build instruction §7). Turns an APPROVED version's stored
// results into a flat, labeled, traceable row set shared by every output — the
// HTML report, the Excel data package, and the PDF. No I/O, no React; compiles
// standalone (tests/fna-report.test.mjs). Every figure keeps its formula id +
// version so the report is reproducible from the version.

import { FINRA_DISCLAIMER } from '../compliance'

// The mandatory FINRA educational footer (build instruction §4.2). Sourced from the
// single legal-frozen constant (screen.ts uses the same) so the report footer and
// the generator footer can never drift — one place to change under legal review.
export const REPORT_DISCLOSURE = FINRA_DISCLAIMER

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

// How a numeric output field is rendered. Money is the safe default; the map lists
// only the NON-money exceptions so a new money field can never be mis-rendered.
type FieldFormat = 'money' | 'fraction_pct' | 'whole_pct' | 'count' | 'duration'

// Explicit per-field format for engine output keys whose NAME would otherwise be
// guessed wrong (fixes a real defect: monthlyIncomeMargin is money — the old
// "contains 'margin'" heuristic rendered a $500/mo margin as "50000.0%";
// targetReplacementPct is already a whole percent, not a 0..1 fraction; the *Count
// fields are integers, not dollars).
const FIELD_FORMAT: Record<string, FieldFormat> = {
  // 0..1 fractions shown as a percentage (×100)
  savingsRate: 'fraction_pct',
  coverageRatio: 'fraction_pct',
  adequacyRatio: 'fraction_pct',
  fundedRatio: 'fraction_pct',
  realRate: 'fraction_pct',
  realPostRate: 'fraction_pct',
  monthlyRate: 'fraction_pct',
  annualRate: 'fraction_pct',
  // already a whole percent (0..100), shown as-is with a % sign
  targetReplacementPct: 'whole_pct',
  // integer counts (not currency)
  assetCount: 'count',
  liabilityCount: 'count',
  // number of periods / age (not currency, not a percent)
  monthsCovered: 'duration',
  targetMonths: 'duration',
  currentAge: 'duration',
}

function fieldFormat(key: string): FieldFormat {
  const explicit = FIELD_FORMAT[key]
  if (explicit) return explicit
  const k = key.toLowerCase()
  if (k.endsWith('pct') || k.endsWith('percent')) return 'whole_pct'
  if (k.includes('ratio') || k.includes('rate')) return 'fraction_pct'
  if (k.includes('count')) return 'count'
  if (k.includes('months') || k.includes('years') || k.includes('age')) return 'duration'
  return 'money'
}

function fmt(key: string, value: number): string {
  switch (fieldFormat(key)) {
    case 'fraction_pct':
      return `${(value * 100).toFixed(1)}%`
    case 'whole_pct':
      return `${value.toFixed(1)}%`
    case 'count':
      return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    case 'duration':
      return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
    case 'money':
    default:
      return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  }
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
