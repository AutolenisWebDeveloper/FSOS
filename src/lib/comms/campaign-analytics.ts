// One analytics contract for the three native campaign engines.
//
// Before this module there were three return shapes behind one function name
// (`campaignAnalytics`): `CampaignAnalytics` in life-campaign (flat counts + byPhase),
// a different `CampaignAnalytics` in cross-sell-life (nested `totals` + funnel + rates +
// channels + version), and `WinbackAnalytics` (flat counts + byPhase + byCategory +
// eligibleNow). Nothing could be shared across the three dashboards because no shared
// component could name a field that existed on all three.
//
// This is the superset: a universal core every engine populates, plus optional blocks an
// engine fills only if it measures that thing. A shared panel reads the core and renders
// an optional block when it is present.
//
// Everything here is PURE — no DB, no React, no env. Each engine's `analytics.ts` does its
// own reads and hands the rows to these tallies. Exercised by
// tests/comms-campaign-analytics.test.mjs.

// ─── The contract ─────────────────────────────────────────────────────────────

export interface CampaignTotals {
  /**
   * Every enrollment still moving through the timeline, INCLUDING the paused variants.
   *
   * This deliberately differs from the pre-unification behaviour on two of the three
   * engines. Life Conversion and Win-Back headlined `enrollments['active']` — the narrow
   * bucket — while computing the phase distribution over the broad set. So the KPI tile
   * read "Active enrollments 12" above a phase distribution that summed to 15, on the
   * same screen, with no way to tell which was wrong. `active` and `byPhase` now count
   * the same population, and the held subset is surfaced separately as `paused`.
   */
  active: number
  /** The subset of `active` that is held (admin pause, open conversation, advisor hold). */
  paused: number
  completed: number
  /** Left the campaign before completion, for any reason, including suppression. */
  exited: number
  /** The compliance-driven subset of `exited` — consent, DNC, or the securities firewall. */
  suppressed: number
}

export interface TouchTotals {
  sent: number
  suppressed: number
  skipped: number
  scheduled: number
  missed: number
  dead_letter: number
}

export interface AdvisorTotals {
  total: number
  fulfilled: number
  overdue: number
  missed: number
}

export interface PhaseTotals {
  early: number
  mid: number
  accelerated: number
}

export interface ChannelTotals {
  email: number
  sms: number
  ai: number
}

export interface CampaignFunnel {
  enrolled: number
  appointments: number
  quotes: number
  applications: number
  issued: number
  purchasedElsewhere: number
  notInterested: number
  optOuts: number
}

export interface CampaignRates {
  enrollToAppointment: number
  appointmentToQuote: number
  quoteToApplication: number
  applicationToIssued: number
  overall: number
}

export interface CampaignAnalytics {
  // ── Universal core — every engine populates all of these ──
  status: string
  /** Raw count per lifecycle status, for any breakdown a surface wants. */
  enrollments: Record<string, number>
  totals: CampaignTotals
  touches: TouchTotals
  advisor: AdvisorTotals

  // ── Optional blocks — an engine populates one only if it measures it ──
  /** Cross-Sell Life only — the versioned engine (ADR-022). */
  version?: number
  /** Pipeline Win-Back only — live count from v_pipeline_winback_due. */
  eligibleNow?: number
  /** Life Conversion + Pipeline Win-Back — where active enrollments sit on the timeline. */
  byPhase?: PhaseTotals
  /** Pipeline Win-Back only — why each enrollment was won back. */
  byCategory?: Record<string, number>
  /** Cross-Sell Life only — sends by channel, through the compliance gate. */
  channels?: ChannelTotals
  /** Cross-Sell Life only — enrolled → issued. */
  funnel?: CampaignFunnel
  /** Cross-Sell Life only — stage-to-stage conversion, derived from `funnel`. */
  rates?: CampaignRates
}

// ─── Pure tallies ─────────────────────────────────────────────────────────────

/** A percentage to one decimal. A zero denominator is 0%, never NaN or Infinity. */
export function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0
}

export interface PhaseThresholds {
  /** Touch number at which the mid phase begins. */
  midFromTouch: number
  /** Touch number at which the accelerated phase begins. */
  accelFromTouch: number
}

/** Which phase of the timeline a cursor sits in. Boundaries are inclusive lower bounds. */
export function bucketPhase(touchNo: number | null | undefined, thresholds: PhaseThresholds): keyof PhaseTotals {
  const n = touchNo ?? 0
  if (n >= thresholds.accelFromTouch) return 'accelerated'
  if (n >= thresholds.midFromTouch) return 'mid'
  return 'early'
}

export interface EnrollmentRow {
  status: string
  current_touch_no?: number | null
  /** Win-Back only. */
  winback_category?: string | null
  /** Cross-Sell only — drives the opt-out and not-interested funnel counts. */
  exit_reason?: string | null
}

export interface TallyEnrollmentsOptions {
  /** Statuses that count as still moving through the timeline. */
  activeStates: readonly string[]
  /** The subset of `activeStates` that is held rather than advancing. */
  pausedStates: readonly string[]
  /** Statuses that count as having finished the timeline. */
  completedStates: readonly string[]
  /** Statuses that count as having left before completion. */
  exitedStates: readonly string[]
  /** Statuses the compliance layer stopped. Always also counted in `exited`. */
  suppressedStates: readonly string[]
  /** Provide to compute `byPhase`. Omit on engines that do not measure it. */
  phases?: PhaseThresholds
  /** Set to collect `byCategory` from `winback_category`. */
  categorize?: boolean
}

export interface EnrollmentTally {
  enrollments: Record<string, number>
  totals: CampaignTotals
  byPhase?: PhaseTotals
  byCategory?: Record<string, number>
}

/**
 * One pass over the enrollment rows. `totals.active` and `byPhase` are computed from the
 * SAME predicate, so the KPI tile and the phase distribution on a campaign screen always
 * reconcile — see the note on `CampaignTotals.active`.
 */
export function tallyEnrollments(rows: readonly EnrollmentRow[], options: TallyEnrollmentsOptions): EnrollmentTally {
  const active = new Set(options.activeStates)
  const paused = new Set(options.pausedStates)
  const completed = new Set(options.completedStates)
  const exited = new Set(options.exitedStates)
  const suppressed = new Set(options.suppressedStates)

  const enrollments: Record<string, number> = {}
  const totals: CampaignTotals = { active: 0, paused: 0, completed: 0, exited: 0, suppressed: 0 }
  const byPhase: PhaseTotals = { early: 0, mid: 0, accelerated: 0 }
  const byCategory: Record<string, number> = {}

  for (const row of rows) {
    enrollments[row.status] = (enrollments[row.status] ?? 0) + 1
    if (options.categorize && row.winback_category) {
      byCategory[row.winback_category] = (byCategory[row.winback_category] ?? 0) + 1
    }
    if (active.has(row.status)) {
      totals.active++
      if (paused.has(row.status)) totals.paused++
      if (options.phases) byPhase[bucketPhase(row.current_touch_no, options.phases)]++
    }
    if (completed.has(row.status)) totals.completed++
    // Suppression is a *reason* for exiting, so a suppressed row counts once in each —
    // never double-counted inside `exited` itself.
    if (suppressed.has(row.status)) {
      totals.suppressed++
      totals.exited++
    } else if (exited.has(row.status)) {
      totals.exited++
    }
  }

  return {
    enrollments,
    totals,
    ...(options.phases ? { byPhase } : {}),
    ...(options.categorize ? { byCategory } : {}),
  }
}

export interface ExecutionRow {
  status: string
  kind?: string | null
}

export interface ExecutionTally {
  touches: TouchTotals
  channels: ChannelTotals
}

/**
 * Execution outcomes and, for engines that report it, the channel split. Only a `sent`
 * execution counts toward a channel — a suppressed or deferred touch never reached anyone,
 * and counting it as a send would overstate reach on a compliance-facing dashboard.
 */
export function tallyExecutions(rows: readonly ExecutionRow[]): ExecutionTally {
  const touches: TouchTotals = { sent: 0, suppressed: 0, skipped: 0, scheduled: 0, missed: 0, dead_letter: 0 }
  const channels: ChannelTotals = { email: 0, sms: 0, ai: 0 }

  for (const row of rows) {
    if (row.status in touches) touches[row.status as keyof TouchTotals]++
    if (row.status === 'sent') {
      if (row.kind === 'email') channels.email++
      else if (row.kind === 'ai_conversation') channels.ai++
      else if (row.kind === 'sms') channels.sms++
    }
  }

  return { touches, channels }
}

/** Advisor-task states that mean "late and escalating", not merely "not done yet". */
const ADVISOR_OVERDUE = new Set(['overdue', 'escalate', 'reassign'])

export function tallyAdvisor(rows: readonly { status: string }[]): AdvisorTotals {
  const advisor: AdvisorTotals = { total: 0, fulfilled: 0, overdue: 0, missed: 0 }
  for (const row of rows) {
    advisor.total++
    if (row.status === 'fulfilled') advisor.fulfilled++
    else if (ADVISOR_OVERDUE.has(row.status)) advisor.overdue++
    else if (row.status === 'missed') advisor.missed++
  }
  return advisor
}

/**
 * The Cross-Sell conversion funnel. Opens are deliberately NOT engagement (§19) — only an
 * inbound reply or a terminal state advances a stage, so the funnel cannot be inflated by
 * an image-proxy prefetch.
 */
export function tallyFunnel(rows: readonly EnrollmentRow[]): CampaignFunnel {
  const funnel: CampaignFunnel = {
    enrolled: 0,
    appointments: 0,
    quotes: 0,
    applications: 0,
    issued: 0,
    purchasedElsewhere: 0,
    notInterested: 0,
    optOuts: 0,
  }
  for (const row of rows) {
    funnel.enrolled++
    if (row.status === 'appointment_scheduled') funnel.appointments++
    if (row.status === 'quote_requested') funnel.quotes++
    if (row.status === 'application_started') funnel.applications++
    if (row.status === 'policy_issued') funnel.issued++
    if (row.status === 'purchased_elsewhere') funnel.purchasedElsewhere++
    if (row.exit_reason === 'not_interested') funnel.notInterested++
    if (row.exit_reason === 'sms_stop' || row.exit_reason === 'email_unsubscribe' || row.exit_reason === 'global_suppression') {
      funnel.optOuts++
    }
  }
  return funnel
}

/** Stage-to-stage conversion. Each rate is against the PREVIOUS stage, not against enrolled. */
export function funnelRates(funnel: CampaignFunnel): CampaignRates {
  return {
    enrollToAppointment: rate(funnel.appointments, funnel.enrolled),
    appointmentToQuote: rate(funnel.quotes, funnel.appointments),
    quoteToApplication: rate(funnel.applications, funnel.quotes),
    applicationToIssued: rate(funnel.issued, funnel.applications),
    overall: rate(funnel.issued, funnel.enrolled),
  }
}
