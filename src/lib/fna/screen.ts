// src/lib/fna/screen.ts
// GUARDRAIL 2 support for the FNA Generator (docs/legacy-port.md §2.1).
// A generated Financial Needs Analysis is a client-facing artifact, so before it
// can be saved to Document OS or delivered it passes through this pure screen.
// It reuses the same recommendation-language detector the comms guardrail uses
// (lib/compliance/guardrail.ts) so the FNA red line is identical to every other
// AI surface: the report may identify NEEDS and GAPS, but must never make an
// individualized product/policy/investment recommendation or name a product to buy.
//
// Pure (no I/O) so it gates both the generator and the save route, and is
// unit-tested offline (tests/fna.test.mjs) by compiling this file standalone.
import { containsRecommendationLanguage } from '../compliance/guardrail'
import { FINRA_DISCLAIMER } from '../compliance'

/** The exact disclaimer every FNA report must carry, verbatim (§2.1). */
export const FNA_DISCLAIMER = FINRA_DISCLAIMER

export interface FnaRecommendation {
  priority?: number
  title?: string
  description?: string
  /** Product CATEGORY only — never a specific carrier/product name. */
  product_category?: string
}

export interface FnaReport {
  executive_summary?: string
  financial_position?: string
  gaps?: string[]
  recommendations?: FnaRecommendation[]
  next_steps?: string[]
  risk_profile?: string
  urgency?: string
  monthly_retirement_gap?: number
  key_metrics?: Record<string, number>
  compliance_disclaimer?: string
  /** Set when the household holds an is_security product (§2.1 firewall). */
  ffs_managed?: boolean
  [key: string]: unknown
}

export type FnaBlockReason = 'recommendation' | 'missing_disclaimer'

export interface FnaScreenResult {
  allow: boolean
  reasons: FnaBlockReason[]
}

/**
 * All free-text the model produced, concatenated. This is what the red-line
 * detector runs over — the "gaps/needs" framing is fine, "you should buy X" is not.
 * `product_category` is intentionally EXCLUDED: a bare category label
 * ("Life Insurance") is permitted; the detector only screens narrative prose.
 */
export function fnaNarrativeText(report: FnaReport): string {
  const parts: string[] = []
  if (report.executive_summary) parts.push(report.executive_summary)
  if (report.financial_position) parts.push(report.financial_position)
  for (const g of report.gaps ?? []) parts.push(g)
  for (const r of report.recommendations ?? []) {
    if (r.title) parts.push(r.title)
    if (r.description) parts.push(r.description)
  }
  for (const s of report.next_steps ?? []) parts.push(s)
  return parts.join('\n')
}

/**
 * Screen a generated FNA. `allow === true` only when the report carries the
 * verbatim disclaimer AND contains no individualized recommendation language.
 * A failure is a HARD BLOCK: the generator escalates to the human FSA and the
 * save route refuses to persist it.
 */
export function screenFnaReport(report: FnaReport): FnaScreenResult {
  const reasons: FnaBlockReason[] = []
  if (containsRecommendationLanguage(fnaNarrativeText(report))) reasons.push('recommendation')
  if (report.compliance_disclaimer !== FNA_DISCLAIMER) reasons.push('missing_disclaimer')
  return { allow: reasons.length === 0, reasons }
}

/** Force the exact disclaimer onto a report before it is screened/saved. */
export function withDisclaimer(report: FnaReport): FnaReport {
  return { ...report, compliance_disclaimer: FNA_DISCLAIMER }
}
