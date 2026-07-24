// src/lib/fna/intelligence.ts
// PURE planning-intelligence aggregation (build instruction §10). Derives the
// planning signals surfaced onto the EXISTING dashboards — no new dashboard, no
// I/O here (the caller loads rows and passes them in), so it unit-tests offline.
// Signals: planning coverage, planning confidence, data quality, open advisor
// actions, reviews due, and upcoming milestones.

export interface PlanSignal {
  status: string
  /** 0..1 completeness of the plan's current version, if calculated. */
  completeness?: number | null
}

export interface PlanningSignalsInput {
  plans: PlanSignal[]
  /** Open (unresolved) data-quality exceptions across plans. */
  openDataQuality: number
  /** DRAFT (unapproved) human recommendations — open advisor actions. */
  draftRecommendations: number
  /** Reviews scheduled within the milestone window. */
  reviewsDue: number
  /** Policy conversion/renewal dates within the milestone window. */
  policyMilestones: number
}

export interface PlanningSignals {
  plansTotal: number
  approved: number
  /** Calculated/under-review but not yet approved — needs advisor attention. */
  needsAttention: number
  /** Plans below 50% input completeness. */
  lowCompleteness: number
  /** Average completeness across calculated plans, 0..1 (planning confidence). */
  planningConfidence: number
  openDataQuality: number
  openAdvisorActions: number
  reviewsDue: number
  upcomingMilestones: number
}

export function computePlanningSignals(input: PlanningSignalsInput): PlanningSignals {
  const plansTotal = input.plans.length
  const approved = input.plans.filter((p) => p.status === 'APPROVED').length
  const needsAttention = input.plans.filter((p) => p.status === 'CALCULATED' || p.status === 'UNDER_REVIEW').length

  const withCompleteness = input.plans.filter((p) => typeof p.completeness === 'number') as Array<{ completeness: number }>
  const lowCompleteness = withCompleteness.filter((p) => p.completeness < 0.5).length
  const planningConfidence =
    withCompleteness.length === 0 ? 0 : withCompleteness.reduce((s, p) => s + p.completeness, 0) / withCompleteness.length

  return {
    plansTotal,
    approved,
    needsAttention,
    lowCompleteness,
    planningConfidence,
    openDataQuality: input.openDataQuality,
    openAdvisorActions: input.draftRecommendations,
    reviewsDue: input.reviewsDue,
    upcomingMilestones: input.reviewsDue + input.policyMilestones,
  }
}
