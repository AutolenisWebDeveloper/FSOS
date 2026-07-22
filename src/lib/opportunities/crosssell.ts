// src/lib/opportunities/crosssell.ts
// The PURE planner that turns a detected coverage gap (v_cross_sell_gaps) into an
// explainable, deduplicated cross-sell OPPORTUNITY draft. Deliberately DB-free
// (imports nothing) so the eligibility, dedup, and firewall rules are unit-provable
// in isolation — the same discipline as lib/ai/outreach.ts and lib/ai/command-center.ts.
//
// This closes the §13.1 gap: cross-sell detection previously only logged an activity
// or sent outreach; it never created a tracked, attributed, deduplicated pipeline
// opportunity. The impure service (lib/opportunities/originate.ts) reads the gaps +
// existing opportunities, calls planCrossSellOpportunities(), and persists the drafts.
//
// GUARDRAILS baked in here (not just documented):
//   • Securities firewall — a cross-sell opportunity is ALWAYS is_security=false. A
//     coverage gap is a life/P&C review invitation, never a securities target. The
//     draft type makes is_security a literal `false`, unforgeable by a caller.
//   • No invented Farmers data — the draft carries NO commission/premium figure; those
//     are priced by the licensed FSA (§4.3). The planner only records the evidence.
//   • Dedup across the household — one OPEN cross-sell opportunity per household; a
//     household is never worked twice concurrently for the same source.

/** Provenance tag written to opportunities.source (mig 045) for attribution + dedup. */
export const CROSS_SELL_SOURCE = 'cross_sell'

/** Stages at which an opportunity is finished and no longer blocks re-origination. */
export const TERMINAL_STAGES = ['placed_issued', 'lost'] as const
export type TerminalStage = (typeof TERMINAL_STAGES)[number]

/** A row of v_cross_sell_gaps (the columns the planner needs). */
export interface CrossSellGap {
  household_id: string
  primary_name: string | null
  referring_agency_id: string | null
  next_best_line: string | null
  gap_count: number
  has_life: boolean
  score: number
}

/** An existing opportunity row used only to dedup (household + source + stage). */
export interface ExistingOpp {
  household_id: string
  source: string | null
  stage: string
}

export type CrossSellEngagement = 'co_sell' | 'direct'

/** The additive opportunity draft the service persists. is_security is a literal false. */
export interface CrossSellOpportunityDraft {
  household_id: string
  referring_agency_id: string | null
  /** A coverage gap has no specific product yet — the FSA selects one during fact-find. */
  product_id: null
  engagement: CrossSellEngagement
  stage: 'prospect'
  is_security: false
  source: typeof CROSS_SELL_SOURCE
  /** The open coverage line (e.g. 'life', 'auto') — the reason this opportunity exists. */
  line: string
  reason: string
  score: number
}

export interface PlanResult {
  drafts: CrossSellOpportunityDraft[]
  skipped: { household_id: string; reason: 'no_open_line' | 'duplicate_open' }[]
}

/** A gap is workable when it has a household, an open line, and at least one gap. */
export function isEligibleGap(gap: CrossSellGap): boolean {
  return Boolean(gap.household_id) && Boolean(gap.next_best_line) && gap.gap_count > 0
}

/** Agency-referred gaps are worked as a co-sell with the partner; else direct. */
export function engagementForGap(gap: CrossSellGap): CrossSellEngagement {
  return gap.referring_agency_id ? 'co_sell' : 'direct'
}

/** A human-readable, evidence-grounded reason — never a product recommendation. */
export function crossSellReason(gap: CrossSellGap): string {
  const line = gap.next_best_line ?? 'coverage'
  const lifeNote = gap.has_life ? '' : ' · no life on file'
  const plural = gap.gap_count === 1 ? '' : 's'
  return `Cross-sell: ${line} coverage gap${lifeNote} (${gap.gap_count} open line${plural}).`
}

/** True if the household already has an OPEN (non-terminal) cross-sell opportunity. */
function hasOpenCrossSell(byHousehold: Map<string, boolean>, householdId: string): boolean {
  return byHousehold.get(householdId) === true
}

/**
 * Plan cross-sell opportunity drafts from detected gaps, deduplicated against the
 * households that already carry an open cross-sell opportunity (and within the batch
 * itself). Ineligible gaps are skipped with a reason. Every draft is is_security=false.
 */
export function planCrossSellOpportunities(gaps: CrossSellGap[], existingOpen: ExistingOpp[]): PlanResult {
  // Households already carrying an OPEN cross-sell opportunity — the dedup guard.
  const openByHousehold = new Map<string, boolean>()
  for (const o of existingOpen) {
    if (o.source !== CROSS_SELL_SOURCE) continue
    if ((TERMINAL_STAGES as readonly string[]).includes(o.stage)) continue
    openByHousehold.set(o.household_id, true)
  }

  const drafts: CrossSellOpportunityDraft[] = []
  const skipped: PlanResult['skipped'] = []
  const draftedThisBatch = new Set<string>()

  for (const gap of gaps) {
    if (!isEligibleGap(gap)) {
      skipped.push({ household_id: gap.household_id, reason: 'no_open_line' })
      continue
    }
    if (hasOpenCrossSell(openByHousehold, gap.household_id) || draftedThisBatch.has(gap.household_id)) {
      skipped.push({ household_id: gap.household_id, reason: 'duplicate_open' })
      continue
    }
    draftedThisBatch.add(gap.household_id)
    drafts.push({
      household_id: gap.household_id,
      referring_agency_id: gap.referring_agency_id,
      product_id: null,
      engagement: engagementForGap(gap),
      stage: 'prospect',
      is_security: false,
      source: CROSS_SELL_SOURCE,
      line: gap.next_best_line as string,
      reason: crossSellReason(gap),
      score: gap.score,
    })
  }

  return { drafts, skipped }
}
