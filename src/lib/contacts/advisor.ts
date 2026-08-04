/*
 * Contact 360 AI Advisor engine (redesign spec §8) — GREEN ZONE.
 *
 * This is a deterministic, data-grounded insight builder: it surfaces facts,
 * deadlines, and gaps, and recommends WORKFLOW actions only (schedule, create
 * opportunity, route to a licensed review). It NEVER recommends a specific
 * product, makes a suitability/best-interest determination, or frames anything
 * as a securities call to action (guardrail §4.2). Gaps are framed as
 * "discussion topics for a review", never as something to sell.
 *
 * Pure and side-effect-free so it is unit-testable and can run in the record's
 * server component and (condensed) in the Contact Peek from the same source.
 */

export type AdvisorSeverity = 'high' | 'medium' | 'info'

export interface AdvisorInsight {
  id: string
  severity: AdvisorSeverity
  text: string
}

export interface AdvisorAction {
  label: string
  href: string
}

export interface AdvisorInputs {
  householdId: string
  doNotContact: boolean
  members: { relationship: string | null }[]
  policies: { is_with_us: boolean; is_security: boolean; status: string; conversion_deadline: string | null }[]
  reviews: { created_at: string }[]
  openOpportunities: number
  /** Injectable clock for deterministic tests. */
  now?: number
}

/** Days from `now` to an ISO/date string (positive = future); null if unparseable. */
function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.round((t - now) / 86400000)
}

const SEVERITY_ORDER: Record<AdvisorSeverity, number> = { high: 0, medium: 1, info: 2 }
const SPOUSE = /spouse|partner|husband|wife/i
const CONVERSION_WINDOW_DAYS = 90

export interface AdvisorResult {
  insights: AdvisorInsight[]
  actions: AdvisorAction[]
  /** Short green-zone bounding note rendered under the panel. */
  disclaimer: string
}

export function buildAdvisor(input: AdvisorInputs): AdvisorResult {
  const now = input.now ?? Date.now()
  const insights: AdvisorInsight[] = []

  // 1. Term-conversion window closing (soonest future deadline within the window).
  //    Securities policies are excluded from the signal (firewall §4.1).
  const deadlines = input.policies
    .filter((p) => !p.is_security && p.conversion_deadline)
    .map((p) => daysUntil(p.conversion_deadline, now))
    .filter((d): d is number => d !== null && d >= 0 && d <= CONVERSION_WINDOW_DAYS)
    .sort((a, b) => a - b)
  if (deadlines.length > 0) {
    const d = deadlines[0]
    insights.push({
      id: 'conversion-window',
      severity: d <= 30 ? 'high' : 'medium',
      text: `Term-conversion window closes in ${d} day${d === 1 ? '' : 's'} — a discussion topic for a review.`,
    })
  }

  // 2. Held-away (competitor) coverage → cross-sell review opportunity.
  const heldAway = input.policies.some((p) => !p.is_with_us && !p.is_security && p.status === 'active')
  if (heldAway) {
    insights.push({
      id: 'held-away',
      severity: 'medium',
      text: 'Held-away coverage on file — a cross-sell review may be worth scheduling.',
    })
  }

  // 3. Spouse/partner on file → confirm household coverage at a review (not a product rec).
  if (input.members.some((m) => m.relationship && SPOUSE.test(m.relationship))) {
    insights.push({
      id: 'spouse-coverage',
      severity: 'info',
      text: 'Spouse/partner on file — confirm household life coverage at the next review.',
    })
  }

  // 4. Review recency.
  if (input.reviews.length === 0) {
    insights.push({ id: 'no-review', severity: 'medium', text: 'No financial review on file yet.' })
  } else {
    const latest = input.reviews
      .map((r) => new Date(r.created_at).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => b - a)[0]
    if (latest) {
      const months = Math.floor((now - latest) / (1000 * 60 * 60 * 24 * 30))
      if (months >= 12) {
        insights.push({ id: 'review-stale', severity: 'medium', text: `Last review ${months} months ago — an annual review is due.` })
      }
    }
  }

  // 5. Open opportunities in flight.
  if (input.openOpportunities > 0) {
    insights.push({
      id: 'open-opps',
      severity: 'info',
      text: `${input.openOpportunities} open opportunit${input.openOpportunities === 1 ? 'y' : 'ies'} in the pipeline.`,
    })
  }

  // 6. Do-not-contact informational note.
  if (input.doNotContact) {
    insights.push({ id: 'dnc', severity: 'info', text: 'Do-not-contact is set — automated outreach is excluded.' })
  }

  insights.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  const id = input.householdId
  const actions: AdvisorAction[] = [
    { label: 'Schedule review', href: `/app/reviews/new?household=${id}` },
    { label: 'Create opportunity', href: `/app/opportunities/new?household=${id}` },
    { label: 'Route to licensed review', href: `/app/reviews/new?household=${id}` },
  ]

  return {
    insights,
    actions,
    disclaimer:
      'Workflow guidance only — not a product recommendation or suitability determination. Anything product- or securities-facing initiates a licensed FSA review.',
  }
}

/** The single most important insight, for the condensed Contact Peek summary. */
export function topInsight(result: AdvisorResult): AdvisorInsight | null {
  return result.insights[0] ?? null
}
