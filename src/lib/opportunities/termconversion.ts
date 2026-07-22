// src/lib/opportunities/termconversion.ts
// The PURE planner that turns a convertible term policy (v_conversions_due) into a
// deadline-grounded, deduplicated term_conversion OPPORTUNITY draft. Deliberately
// DB-free (imports nothing) so eligibility, the securities firewall, and dedup are
// unit-provable in isolation — the same discipline as crosssell.ts / winback.ts.
//
// Closes the §13.3 gap: term-conversion detection writes an `activity` (conversionWatch)
// or sends educational outreach; it never originated a tracked, attributed,
// deduplicated pipeline opportunity from a policy's conversion window. The impure
// service (lib/opportunities/originate.ts) reads the view + existing term_conversion
// opportunities, calls planTermConversionOpportunities(), and persists the drafts.
//
// GUARDRAILS baked in here (not just documented):
//   • Securities firewall (§4.1) — a securities-flagged policy is EXCLUDED (routed to
//     human/FFS, never originated). is_security is checked FIRST, and every draft is a
//     literal is_security:false, unforgeable by a caller.
//   • No invented Farmers data (§4.3 / §13.3) — the deadline/urgency come from the
//     policy's STORED conversion_deadline; nothing is invented, and the reason is
//     educational, never a product/conversion recommendation. No commission is set.
//   • Dedup per policy — one OPEN term_conversion opportunity per policy.

/** Provenance tag written to opportunities.source for attribution + dedup. */
export const TERM_CONVERSION_SOURCE = 'term_conversion'

/** Stages at which an opportunity is finished and no longer blocks re-origination. */
export const TERMINAL_STAGES = ['placed_issued', 'lost'] as const

/** The view's non-actionable tier — deadlines more than a year out are not worked yet. */
export const BEYOND_TIER = 'beyond'

/** A row of v_conversions_due (the columns the planner needs). */
export interface ConversionRow {
  policy_id: string
  household_id: string | null
  product_id: string | null
  policy_number: string | null
  conversion_deadline: string | null
  is_security: boolean
  days_remaining: number | null
  urgency_tier: string
}

/** An existing opportunity used only to dedup (policy + source + stage). */
export interface ExistingConversionOpp {
  policy_id: string | null
  source: string | null
  stage: string
}

/** Finer urgency windows than the view's tiers — for the reason + operator triage. */
export type UrgencyWindow = '7' | '14' | '30' | '60' | '90' | '180' | '365'

export interface TermConversionDraft {
  policy_id: string
  household_id: string | null
  product_id: string | null
  referring_agency_id: null
  engagement: 'direct'
  stage: 'prospect'
  is_security: false
  source: typeof TERM_CONVERSION_SOURCE
  days_remaining: number
  window: UrgencyWindow
  deadline: string | null
  reason: string
}

export interface TermConversionPlanResult {
  drafts: TermConversionDraft[]
  skipped: { policy_id: string; reason: 'securities_excluded' | 'not_actionable' | 'duplicate_open' }[]
}

/** Bucket days-to-deadline into an urgency window (7/14/30/60/90/180/365). */
export function urgencyWindow(days: number): UrgencyWindow {
  if (days <= 7) return '7'
  if (days <= 14) return '14'
  if (days <= 30) return '30'
  if (days <= 60) return '60'
  if (days <= 90) return '90'
  if (days <= 180) return '180'
  return '365'
}

/**
 * Eligible = a real, non-securities policy inside an actionable window with a
 * present, non-negative days-to-deadline. Securities policies are never eligible
 * (they are excluded by planTermConversionOpportunities with an explicit reason).
 */
export function isEligibleConversion(row: ConversionRow): boolean {
  return (
    Boolean(row.policy_id) &&
    row.is_security !== true &&
    row.urgency_tier !== BEYOND_TIER &&
    typeof row.days_remaining === 'number' &&
    row.days_remaining >= 0
  )
}

/**
 * An educational, deadline-grounded reason. It cites the STORED conversion deadline
 * and frames an educational review invitation — never a product/conversion
 * recommendation or a securities call-to-action (§4.2 / §13.3).
 */
export function conversionReason(row: ConversionRow): string {
  const days = typeof row.days_remaining === 'number' ? row.days_remaining : 0
  const deadline = row.conversion_deadline ? ` (deadline ${row.conversion_deadline})` : ''
  return `Term-conversion window: ${days} days to the conversion deadline${deadline} — educational review invitation.`
}

function isTerminal(stage: string): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage)
}

/**
 * Plan term_conversion opportunity drafts from due-conversion rows. Securities rows are
 * EXCLUDED first (firewall). Remaining rows are deduplicated against policies that
 * already carry an open term_conversion opportunity (and within the batch). Every draft
 * is is_security=false and product-attributed from the policy.
 */
export function planTermConversionOpportunities(
  rows: ConversionRow[],
  existingOpen: ExistingConversionOpp[],
): TermConversionPlanResult {
  const openByPolicy = new Set<string>()
  for (const o of existingOpen) {
    if (o.source !== TERM_CONVERSION_SOURCE) continue
    if (isTerminal(o.stage)) continue
    if (o.policy_id) openByPolicy.add(o.policy_id)
  }

  const drafts: TermConversionDraft[] = []
  const skipped: TermConversionPlanResult['skipped'] = []
  const draftedThisBatch = new Set<string>()

  for (const row of rows) {
    // Firewall first: a securities-flagged policy is never originated — route to FFS.
    if (row.is_security === true) {
      skipped.push({ policy_id: row.policy_id, reason: 'securities_excluded' })
      continue
    }
    if (!isEligibleConversion(row)) {
      skipped.push({ policy_id: row.policy_id, reason: 'not_actionable' })
      continue
    }
    if (openByPolicy.has(row.policy_id) || draftedThisBatch.has(row.policy_id)) {
      skipped.push({ policy_id: row.policy_id, reason: 'duplicate_open' })
      continue
    }
    draftedThisBatch.add(row.policy_id)
    const days = row.days_remaining as number
    drafts.push({
      policy_id: row.policy_id,
      household_id: row.household_id,
      product_id: row.product_id,
      referring_agency_id: null,
      engagement: 'direct',
      stage: 'prospect',
      is_security: false,
      source: TERM_CONVERSION_SOURCE,
      days_remaining: days,
      window: urgencyWindow(days),
      deadline: row.conversion_deadline,
      reason: conversionReason(row),
    })
  }

  return { drafts, skipped }
}
