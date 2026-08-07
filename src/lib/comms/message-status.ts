// The single source of truth for how a comm_messages row PRESENTS in the UI.
//
// Before this module, seven call sites hand-mapped `delivery_status` to a badge
// variant inline, and they disagreed: /comms/sms and /comms/email fell through
// `failed`/`bounced` to the amber `pending` chip, so a hard bounce read to the FSA
// as "still in flight" while /comms/delivery showed the same row as `lost`. On a
// surface that exists to prove nothing was silently dropped, that is a compliance
// legibility defect, not a styling nit.
//
// It also restores the distinction the gate actually makes. `evaluateGate` has 15
// steps in TWO tiers (gate.ts): four are non-escalating OPERATIONAL DEFERRALS that
// retry on a later cycle (sms_live, business_hours, frequency, collision), and the
// rest are COMPLIANCE BLOCKS that escalate to a human. The UI used to flatten both
// into one red chip captioned with a raw enum (`blocked: quiet_hours`). An advisor
// could not tell "this retries in an hour" from "this is a TCPA stop."
//
// RELATIONSHIP TO lib/comms/timeline.ts — read before editing DELIVERY below.
// `timeline.ts:statusBadge` presents a WIDER union (delivery lifecycle + engagement
// events + dispatcher decisions) for the contact/appointment timeline surfaces. This
// module presents the NARROWER `comm_messages.delivery_status` column for the message
// log. They overlap on the delivery lifecycle and MUST NOT disagree there — a row that
// is amber in a timeline cannot be green in the log. Parity is asserted in
// tests/comms-message-status.test.mjs (DELIVERY_PARITY); change one, change both.
//
// PURE — no React, no DB, no env. Imported by both Server and Client Components and
// exercised directly by tests/comms-message-status.test.mjs.

import type { GateStep } from './gate'

/** Badge variants this module is allowed to emit (ui/badge.tsx). */
export type StatusVariant = 'won' | 'pending' | 'lost' | 'blocked' | 'draft' | 'outline'

export interface MessageStatusPresentation {
  /** Badge variant — the chip color. */
  variant: StatusVariant
  /** Human label. Sentence case; the badge itself uppercases. */
  label: string
  /** Longer explanation for `title`/tooltip. Never a raw enum. */
  description: string
}

/**
 * Delivery states written by the dispatcher + provider webhooks. `unknown` covers
 * any value a future provider adds, so the UI degrades to a neutral chip with the
 * raw value rather than silently mis-coloring it as success.
 */
const DELIVERY: Record<string, MessageStatusPresentation> = {
  delivered: { variant: 'won', label: 'Delivered', description: 'Confirmed delivered by the provider.' },
  // `sent` is provider-accepted, NOT provider-confirmed — it reads amber, matching
  // timeline.ts. Only `delivered` earns the success chip.
  sent: { variant: 'pending', label: 'Sent', description: 'Accepted by the provider; delivery confirmation pending.' },
  queued: { variant: 'pending', label: 'Queued', description: 'Passed the gate and waiting on the dispatcher.' },
  received: { variant: 'outline', label: 'Received', description: 'Inbound message from the contact — no delivery outcome applies.' },
  failed: { variant: 'lost', label: 'Failed', description: 'The provider rejected this send. Retries are idempotent.' },
  bounced: { variant: 'lost', label: 'Bounced', description: 'Hard bounce — the address is undeliverable and is suppressed.' },
  // A spam complaint is the most damaging deliverability outcome there is; it must never
  // render quieter than a bounce (see DELIVERY_PARITY in tests/comms-message-status).
  complained: { variant: 'lost', label: 'Complained', description: 'Recipient marked this as spam — the address is suppressed and sender reputation is affected.' },
  blocked: { variant: 'blocked', label: 'Blocked', description: 'Held by the communications gate. Never silently dropped.' },
}

/** Present a `comm_messages.delivery_status`. Unknown values stay visibly unknown. */
export function deliveryStatus(status: string | null | undefined): MessageStatusPresentation {
  if (!status) return { variant: 'outline', label: '—', description: 'No delivery status recorded.' }
  return (
    DELIVERY[status] ?? {
      variant: 'outline',
      label: status,
      description: 'Unrecognized delivery status — shown as reported by the provider.',
    }
  )
}

/**
 * The four non-escalating steps in gate.ts. These are deferrals: the send is held
 * and retried on a later cycle, and no compliance event is recorded. Kept as a
 * `Record<GateStep, boolean>`-shaped set so adding a step to `GateStep` without
 * classifying it here is a type error rather than a silent mis-label.
 */
const DEFERRAL_STEPS = {
  sms_live: true,
  business_hours: true,
  frequency: true,
  collision: true,
} as const satisfies Partial<Record<GateStep, true>>

export type GateOutcomeTier = 'sent' | 'deferred' | 'blocked'

export interface GateOutcomePresentation {
  tier: GateOutcomeTier
  variant: StatusVariant
  label: string
  description: string
}

/** Advisor-facing wording for each gate step. Never shown as a raw enum. */
const STEP_LABEL: Record<GateStep, string> = {
  ownership: 'Ownership unresolved',
  consent: 'No consent',
  quiet_hours: 'Quiet hours',
  business_hours: 'Outside hours',
  sms_live: 'Awaiting A2P',
  frequency: 'Frequency cap',
  collision: 'Campaign collision',
  delegation: 'No delegation',
  dnc: 'Do not contact',
  approved_template: 'Unapproved template',
  personalization: 'Merge token missing',
  recommendation: 'Recommendation language',
  is_security: 'Securities record',
  data_confidence: 'Unverified claim',
  other_rule: 'Rule block',
}

const STEP_DESCRIPTION: Record<GateStep, string> = {
  ownership: 'Ownership could not be resolved — routed to assignment review.',
  consent: 'No valid channel consent on file for this recipient.',
  quiet_hours: 'Outside the 9:00–20:00 recipient-local TCPA floor (SMS marketing sends).',
  business_hours: 'Outside your configured hours of operation — retries next cycle.',
  sms_live: 'SMS is staged pending A2P 10DLC approval — held, not dropped.',
  frequency: 'Recipient frequency cap reached — held for a later cycle.',
  collision: 'A higher-priority campaign or live conversation is underway — paused.',
  delegation: 'No active, in-scope delegation to send on the agency owner’s behalf.',
  dnc: 'Recipient is on the do-not-contact list.',
  approved_template: 'Does not use an approved template or AI policy.',
  personalization: 'A required merge token did not resolve — complete it to send.',
  recommendation: 'Contains individualized recommendation or call-to-action language.',
  is_security: 'Securities-flagged record — excluded from automation; route to FFS.',
  data_confidence: 'Rests on unverified or conflicting data — a verification task was raised.',
  other_rule: 'Blocked by an FFS, Farmers, carrier, state, or federal rule.',
}

function isGateStep(step: string): step is GateStep {
  return step in STEP_LABEL
}

/**
 * Present the gate outcome for a message row: what the gate decided and whether the
 * advisor needs to act. `blocked_step` wins when present, because a blocked row is
 * defined by WHY it was held, not by its delivery status.
 */
export function gateOutcome(args: {
  blockedStep: string | null | undefined
  consentAtSend?: boolean | null
}): GateOutcomePresentation {
  const { blockedStep, consentAtSend } = args

  if (blockedStep) {
    if (!isGateStep(blockedStep)) {
      return {
        tier: 'blocked',
        variant: 'blocked',
        label: blockedStep,
        description: 'Held by the gate for an unrecognized reason — review before resending.',
      }
    }
    const deferred = blockedStep in DEFERRAL_STEPS
    return {
      tier: deferred ? 'deferred' : 'blocked',
      // Deferrals are amber (operational, self-resolving); compliance blocks are the
      // blocked chip so they read as "a human must look at this."
      variant: deferred ? 'pending' : 'blocked',
      label: STEP_LABEL[blockedStep],
      description: STEP_DESCRIPTION[blockedStep],
    }
  }

  if (consentAtSend) {
    return { tier: 'sent', variant: 'won', label: 'Consent on file', description: 'Consent was verified at send time and recorded.' }
  }
  return { tier: 'sent', variant: 'draft', label: 'Passed gate', description: 'Cleared every gate step at send time.' }
}

/** Delivery states that mean the send did not land and a human should look. */
const ATTENTION_STATUSES: ReadonlySet<string> = new Set(['failed', 'bounced', 'complained'])

/** True when the row needs a human — used to sort and to tint attention rows. */
export function needsAttention(row: { delivery_status?: string | null; blocked_step?: string | null }): boolean {
  if (row.blocked_step) return gateOutcome({ blockedStep: row.blocked_step }).tier === 'blocked'
  return ATTENTION_STATUSES.has(row.delivery_status ?? '')
}
