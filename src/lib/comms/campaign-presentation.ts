// Shared presentation vocabulary for the three native campaign engines — Life
// Conversion, Cross-Sell Life, and Pipeline Win-Back.
//
// Before this module the same four maps were redeclared per page:
//   • STATUS_TONE      — 5 copies across the three modules
//   • KIND_LABEL       — 3 copies
//   • KIND_TONE        — 2 copies
//   • APPROVAL_TONE    — 1 copy that the other two modules simply went without,
//                        so an unapproved asset was invisible on two of three screens
//
// Beyond the duplication, every copy mapped campaign status onto the GENERIC badge
// variants (`default` / `secondary` / `outline` / `destructive`) instead of the FSOS
// status tokens the design system defines for exactly this (`active`, `pending`,
// `blocked`, `escalated`…). The result: an Active campaign rendered as a solid
// primary-fill chip identical to any other `default` badge, so campaign state did not
// read the way state reads everywhere else in FSOS.
//
// PURE — no React, no DB, no env. Exercised by tests/comms-campaign-presentation.test.mjs,
// which also COMPILES every consuming page (see that file's header for why).

import type { StatusVariant } from './message-status'

/**
 * The badge variants this vocabulary is allowed to resolve to. A strict union rather
 * than `string`, so a typo lands as a compile error at the map instead of a silently
 * unstyled chip at runtime. Every member exists in `badgeVariants` (ui/badge.tsx).
 */
export type CampaignVariant = StatusVariant | 'active' | 'escalated'

export interface Presentation {
  variant: CampaignVariant
  /** Sentence-case human label. Never a raw enum. */
  label: string
  /** One sentence explaining what the state means operationally. Rendered as `title`. */
  description: string
}

// ─── Campaign lifecycle status ────────────────────────────────────────────────

/**
 * The campaign state machine shared by all three engines (see each module's
 * `states.ts` / `engine.ts`). Mapped onto the semantic FSOS status tokens rather
 * than generic badge fills, so "this campaign is live" reads the same as every
 * other live thing in the product.
 */
const CAMPAIGN_STATUS: Record<string, Presentation> = {
  draft: { variant: 'draft', label: 'Draft', description: 'Not yet submitted for approval. Nothing dispatches.' },
  approval_pending: { variant: 'pending', label: 'Approval pending', description: 'Awaiting human approval before it can be activated.' },
  active: { variant: 'active', label: 'Active', description: 'Live — the engine dispatches touches on schedule.' },
  running: { variant: 'active', label: 'Active', description: 'Live — the engine dispatches touches on schedule.' },
  paused: { variant: 'pending', label: 'Paused', description: 'Dispatch halted. Enrollments hold their place in the timeline.' },
  disabled: { variant: 'blocked', label: 'Disabled', description: 'Stopped, and active enrollments are paused until it is re-enabled.' },
  emergency_stopped: { variant: 'escalated', label: 'Emergency stopped', description: 'Every outbound touch halted immediately. Re-enabling is a deliberate action.' },
  archived: { variant: 'outline', label: 'Archived', description: 'Permanently read-only.' },
}

export function campaignStatus(status: string | null | undefined): Presentation {
  if (!status) return { variant: 'outline', label: '—', description: 'No status recorded.' }
  return (
    CAMPAIGN_STATUS[status] ?? {
      variant: 'outline',
      // An unrecognized enum still reads as words rather than `emergency_stopped`.
      label: humanize(status),
      description: 'Unrecognized campaign status.',
    }
  )
}

/** Live states differ per engine (life/win-back use `active`, cross-sell uses `running`). */
export function isCampaignLive(status: string | null | undefined): boolean {
  return status === 'active' || status === 'running'
}

// ─── Enrollment status ────────────────────────────────────────────────────────

/**
 * Enrollment lifecycle across all three engines. Cross-Sell carries the richer set
 * (its funnel states are enrollment statuses); the other two use the common subset.
 */
const ENROLLMENT_STATUS: Record<string, Presentation> = {
  active: { variant: 'active', label: 'Active', description: 'Progressing through the touch timeline.' },
  running: { variant: 'active', label: 'Active', description: 'Progressing through the touch timeline.' },
  enrolled: { variant: 'active', label: 'Enrolled', description: 'Enrolled and awaiting its first touch.' },
  paused: { variant: 'pending', label: 'Paused', description: 'Held. No proactive touch will fire.' },
  paused_by_admin: { variant: 'pending', label: 'Paused by admin', description: 'Held by an operator. No proactive touch will fire.' },
  paused_for_conversation: { variant: 'pending', label: 'In conversation', description: 'A live customer conversation is open — proactive touches are suppressed (ADR-018).' },
  conversation_active: { variant: 'pending', label: 'In conversation', description: 'A live customer conversation is open — proactive touches are suppressed (ADR-018).' },
  waiting_for_advisor: { variant: 'pending', label: 'Waiting for advisor', description: 'Held pending a human advisor task.' },
  advisor_owned: { variant: 'pending', label: 'Advisor owned', description: 'A licensed advisor owns this relationship; automation stands down.' },
  appointment_scheduled: { variant: 'won', label: 'Appointment booked', description: 'Reached an appointment — the campaign goal for this stage.' },
  quote_requested: { variant: 'won', label: 'Quote requested', description: 'The client asked for a quote.' },
  application_started: { variant: 'won', label: 'Application started', description: 'An application is underway.' },
  policy_issued: { variant: 'won', label: 'Policy issued', description: 'Converted — a policy was issued.' },
  purchased_elsewhere: { variant: 'lost', label: 'Bought elsewhere', description: 'Purchased coverage through another channel.' },
  completed: { variant: 'won', label: 'Completed', description: 'Reached the end of the timeline.' },
  converted: { variant: 'won', label: 'Converted', description: 'Reached the campaign goal.' },
  cancelled: { variant: 'outline', label: 'Cancelled', description: 'Cancelled before completion.' },
  exited: { variant: 'outline', label: 'Exited', description: 'Left the campaign before completion.' },
  suppressed: { variant: 'blocked', label: 'Suppressed', description: 'Excluded by consent, DNC, or the securities firewall.' },
  opted_out: { variant: 'blocked', label: 'Opted out', description: 'The recipient opted out. No further contact on this channel.' },
}

export function enrollmentStatus(status: string | null | undefined): Presentation {
  if (!status) return { variant: 'outline', label: '—', description: 'No status recorded.' }
  return (
    ENROLLMENT_STATUS[status] ?? {
      variant: 'outline',
      label: humanize(status),
      description: 'Unrecognized enrollment status.',
    }
  )
}

// ─── Touch kind ───────────────────────────────────────────────────────────────

const TOUCH_KIND: Record<string, Presentation> = {
  email: { variant: 'outline', label: 'Email', description: 'Templated email, dispatched through the compliance gate.' },
  sms: { variant: 'outline', label: 'SMS', description: 'Templated SMS, dispatched through the compliance gate.' },
  ai_conversation: { variant: 'outline', label: 'AI conversation', description: 'AI-opened conversation. Substantive questions escalate to a licensed advisor (§4.2).' },
  advisor_outreach: { variant: 'outline', label: 'Advisor outreach', description: 'A human task. A missed task never stalls the timeline (§9a).' },
}

export function touchKind(kind: string | null | undefined): Presentation {
  if (!kind) return { variant: 'outline', label: '—', description: 'No channel recorded.' }
  return TOUCH_KIND[kind] ?? { variant: 'outline', label: humanize(kind), description: 'Unrecognized touch kind.' }
}

// ─── Template approval ────────────────────────────────────────────────────────

const APPROVAL: Record<string, Presentation> = {
  approved: { variant: 'won', label: 'Approved', description: 'Cleared the human approval gate — the campaign may dispatch it.' },
  submitted: { variant: 'pending', label: 'In review', description: 'Submitted and awaiting approval. Not dispatchable yet.' },
  draft: { variant: 'draft', label: 'Draft', description: 'Not submitted. Not dispatchable.' },
  rejected: { variant: 'lost', label: 'Rejected', description: 'Rejected in review. Not dispatchable.' },
}

/**
 * `null` means the touch has no template at all — a real defect on a dispatchable
 * touch, so it reads as blocked rather than quietly rendering an em dash. Advisor-
 * outreach touches legitimately have no template; callers pass `notApplicable` for
 * those instead of calling this.
 */
export function approvalStatus(status: string | null | undefined): Presentation {
  if (!status) return { variant: 'blocked', label: 'Missing', description: 'No template is linked to this touch — it cannot dispatch.' }
  return APPROVAL[status] ?? { variant: 'outline', label: humanize(status), description: 'Unrecognized approval status.' }
}

// ─── Win-back category (Pipeline Win-Back only) ───────────────────────────────

const WINBACK_CATEGORY: Record<string, string> = {
  lost: 'Lost opportunity',
  stalled_quote: 'Stalled quote',
  abandoned_application: 'Abandoned application',
  inactive: 'Inactive lead',
}

export function winbackCategory(key: string | null | undefined): string {
  if (!key) return '—'
  return WINBACK_CATEGORY[key] ?? humanize(key)
}

// ─── Shared campaign identity ─────────────────────────────────────────────────

export type CampaignEngineKey = 'life_conversion' | 'cross_sell_life' | 'pipeline_winback'

export interface CampaignEngine {
  key: CampaignEngineKey
  /** Display name used in headers, breadcrumbs, and cross-links. */
  title: string
  /** Route root for this engine's UI. */
  href: string
  /** API root — `CampaignControls` posts to `${apiRoot}/${id}/control`. */
  apiRoot: string
  /** Seed migration number, for the empty state's recovery hint. */
  seedMigration: string
  /** Proactive touches on the timeline. Verified against each engine's `schedule.ts`. */
  touches: number
  /** Timeline length in days. Verified against each engine's `schedule.ts`. */
  days: number
  /** One-sentence description used as the page subtitle on both list and detail. */
  description: string
  /** Cross-Sell Life is the only versioned engine — it drives control copy. */
  versioned: boolean
}

/**
 * One registry for the three engines, so every surface derives its title, route,
 * endpoint, and copy from the same place instead of hardcoding them per page. This
 * is what makes the three modules read as one platform rather than three builds.
 *
 * `touches` / `days` are not decorative: they are asserted against each engine's
 * `schedule.ts` in tests/comms-campaign-presentation.test.mjs, so the registry cannot
 * drift away from the timeline it describes.
 */
export const CAMPAIGN_ENGINES: Record<CampaignEngineKey, CampaignEngine> = {
  life_conversion: {
    key: 'life_conversion',
    title: 'Life Conversion',
    href: '/app/comms/life-conversion',
    apiRoot: '/api/life-campaign',
    seedMigration: '082',
    touches: 20,
    days: 180,
    description:
      '180-day, 20-touch term-conversion review campaign across email, SMS, AI conversation, and advisor outreach. Every send passes the compliance gate; eligibility is re-checked before every touch.',
    versioned: false,
  },
  cross_sell_life: {
    key: 'cross_sell_life',
    title: 'Cross-Sell Life',
    href: '/app/comms/cross-sell-life',
    apiRoot: '/api/cross-sell-life',
    seedMigration: '086',
    touches: 35,
    days: 180,
    description:
      '180-day, 35-touch life-insurance cross-sell to existing agency clients. Every send passes the compliance gate; AI conversations stay behind the §4.2 red line.',
    versioned: true,
  },
  pipeline_winback: {
    key: 'pipeline_winback',
    title: 'Pipeline Win-Back',
    href: '/app/comms/pipeline-winback',
    apiRoot: '/api/pipeline-winback',
    seedMigration: '084',
    touches: 24,
    days: 120,
    description:
      '120-day, 24-touch re-engagement for stalled internal pipeline opportunities. Every send passes the compliance gate. Distinct from the imported win-back list at /app/winback (ADR-031).',
    versioned: false,
  },
}

/** Stable iteration order for cross-links and any "all engines" surface. */
export const CAMPAIGN_ENGINE_LIST: CampaignEngine[] = [
  CAMPAIGN_ENGINES.life_conversion,
  CAMPAIGN_ENGINES.cross_sell_life,
  CAMPAIGN_ENGINES.pipeline_winback,
]

/** Breadcrumb trail for any campaign surface. One definition replaces three `crumb()` copies. */
export function campaignBreadcrumb(engine: CampaignEngine, leaf?: string): { label: string; href?: string }[] {
  const trail: { label: string; href?: string }[] = [
    { label: 'FSA', href: '/app' },
    { label: 'Comms', href: '/app/comms' },
  ]
  if (leaf) trail.push({ label: engine.title, href: engine.href }, { label: leaf })
  else trail.push({ label: engine.title })
  return trail
}

/** The console deep-link every campaign header offers. */
export function campaignTestHref(engine: CampaignEngine): string {
  return `/app/comms/console?mode=test&campaign=${engine.key}`
}

/** Detail route for one campaign record of this engine. */
export function campaignDetailHref(engine: CampaignEngine, id: string): string {
  return `${engine.href}/${id}`
}

/** Turn a snake_case enum into readable words. Never leaks an underscore to the UI. */
function humanize(value: string): string {
  return value.replace(/_/g, ' ')
}
