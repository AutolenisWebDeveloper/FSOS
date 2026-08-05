// "Is this campaign OK right now?" — resolved once, in one place, for all three engines.
//
// Every campaign screen leads with four or five equal-weight KPI tiles. Equal weight is
// no hierarchy: an advisor scanning under time pressure has to read all of them and then
// assemble the answer themselves. Worse, the facts that actually stop a campaign from
// working are scattered — approval state lives in the assets section, simulation state in
// the controls section, dead-lettered sends in analytics. A campaign could be Active with
// every template still in draft, and nothing on the screen said so in one place.
//
// This derives the whole answer from data the pages already load, and says it in a
// sentence. PURE — no React, no DB, no env. Exercised by tests/comms-campaign-state.test.mjs.

import { isCampaignLive } from './campaign-presentation'

export type CampaignStateTone =
  /** Dispatching on schedule. */
  | 'live'
  /** Deliberately halted, recoverable — paused. */
  | 'held'
  /** Stopped: disabled, emergency-stopped, or archived. */
  | 'stopped'
  /** Not yet activated: draft or awaiting approval. */
  | 'preparing'

export interface CampaignStateItem {
  key: string
  /** One sentence: what is true, and what it means operationally. */
  text: string
  /** Where to go to resolve it, when there is somewhere to go. */
  href?: string
  hrefLabel?: string
}

export interface CampaignState {
  tone: CampaignStateTone
  /** One sentence answering "is this campaign OK right now?". */
  headline: string
  /** Things preventing this campaign from doing its job. Ordered most-severe first. */
  blockers: CampaignStateItem[]
  /** Worth knowing, but not stopping anything. */
  notes: CampaignStateItem[]
}

export interface CampaignStateInput {
  status: string
  /** ISO timestamp of the last read-only simulation, or null if never run. */
  simulatedAt: string | null
  /** Templates on this campaign that have not cleared the approval gate. */
  unapprovedTemplates?: number
  totalTemplates?: number
  activeEnrollments: number
  /** The subset of active that is held (admin pause, open conversation, advisor hold). */
  pausedEnrollments: number
  suppressedTouches: number
  deadLetterTouches: number
  overdueAdvisorTasks: number
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The headline states what the campaign is doing, and — when it is live — who it is doing
 * it to. "Active" alone is not an answer; "Active, and nothing is enrolled" is.
 */
function headlineFor(input: CampaignStateInput, tone: CampaignStateTone): string {
  const { activeEnrollments: active, pausedEnrollments: paused } = input
  const population =
    active === 0
      ? 'no one is enrolled'
      : paused > 0
        ? `${plural(active, 'enrollment is', 'enrollments are')} in flight, ${paused} of them held`
        : `${plural(active, 'enrollment is', 'enrollments are')} in flight`

  switch (tone) {
    case 'live':
      return active === 0
        ? 'This campaign is live, but no one is enrolled yet — it has nothing to send.'
        : `This campaign is live and ${population}.`
    case 'held':
      return active === 0
        ? 'This campaign is paused. Nothing is enrolled, so nothing is waiting.'
        : `This campaign is paused. ${capitalize(population)} and will hold their place in the timeline until it resumes.`
    case 'stopped':
      if (input.status === 'archived') return 'This campaign is archived and read-only.'
      if (input.status === 'emergency_stopped') {
        return 'This campaign is emergency-stopped. Every outbound touch is halted, and re-enabling it is a deliberate step.'
      }
      return active === 0
        ? 'This campaign is disabled. It will not enroll anyone or send anything.'
        : `This campaign is disabled. ${capitalize(population)}, all paused until it is re-enabled.`
    case 'preparing':
      return input.status === 'approval_pending'
        ? 'This campaign is waiting on approval. It cannot be activated until someone approves it.'
        : 'This campaign is a draft. It will not enroll anyone or send anything until it is activated.'
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function campaignStateTone(status: string): CampaignStateTone {
  if (isCampaignLive(status)) return 'live'
  if (status === 'paused') return 'held'
  if (status === 'disabled' || status === 'emergency_stopped' || status === 'archived') return 'stopped'
  return 'preparing'
}

export function campaignState(input: CampaignStateInput): CampaignState {
  const tone = campaignStateTone(input.status)
  const blockers: CampaignStateItem[] = []
  const notes: CampaignStateItem[] = []

  // ── Blockers: things that stop this campaign doing its job ──

  // Unapproved templates are the highest-value blocker precisely because the campaign
  // looks fine without it — status reads Active while the touches silently cannot fire.
  const unapproved = input.unapprovedTemplates ?? 0
  if (unapproved > 0) {
    const total = input.totalTemplates
    blockers.push({
      key: 'unapproved-templates',
      text:
        `${unapproved} of ${total ?? unapproved} templates have not cleared approval, so ` +
        `${unapproved === 1 ? 'that touch cannot' : 'those touches cannot'} dispatch.`,
      href: '/app/comms/templates',
      hrefLabel: 'Review templates',
    })
  }

  // A dead-lettered touch exhausted its retries and reached no one. It never self-heals.
  if (input.deadLetterTouches > 0) {
    blockers.push({
      key: 'dead-letter',
      text: `${plural(input.deadLetterTouches, 'touch', 'touches')} exhausted every retry and reached no one.`,
    })
  }

  // Archived campaigns are read-only by design — an un-run simulation is not a defect there.
  if (!input.simulatedAt && tone !== 'live' && input.status !== 'archived') {
    blockers.push({
      key: 'never-simulated',
      text: 'This campaign has never been simulated. A read-only simulation shows exactly who it would contact before it contacts anyone (ADR-021).',
    })
  }

  // ── Notes: real, but nothing is stuck ──

  if (input.overdueAdvisorTasks > 0) {
    notes.push({
      key: 'overdue-advisor',
      text: `${plural(input.overdueAdvisorTasks, 'advisor task is', 'advisor tasks are')} overdue. The timeline keeps moving — a missed task never stalls it.`,
    })
  }

  // Suppression is the gate working correctly, so it is never a blocker. It stays visible
  // because a blocked send must never be silently dropped.
  if (input.suppressedTouches > 0) {
    notes.push({
      key: 'suppressed',
      text: `The compliance gate stopped ${plural(input.suppressedTouches, 'touch', 'touches')} — consent, quiet hours, DNC, or the securities firewall.`,
    })
  }

  return { tone, headline: headlineFor(input, tone), blockers, notes }
}
