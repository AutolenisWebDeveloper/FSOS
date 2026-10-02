// src/lib/comms/purpose.ts
// Slice 3 — Message-purpose classification (PURE). Master build instruction §9.
//
// Every automated message is exactly ONE purpose. The purpose drives required consent,
// unsubscribe treatment, quiet-hour treatment, frequency policy, and campaign priority.
// This module is the pure mapping (no DB, no clock) so it is unit-testable offline
// (tests/comms-policy.test.mjs) and reused by the send path + campaign engine.
//
// Consent reality (master build instruction §9): the enforced consent store is the
// `consents` spine table. Slice 3 adds a PURPOSE axis to it; this module maps a message
// purpose to the consent purpose that must be granted for it.

export type MessagePurpose =
  | 'MARKETING'
  | 'TRANSACTIONAL'
  | 'SERVICING'
  | 'APPOINTMENT'
  | 'RELATIONSHIP'
  | 'BIRTHDAY'
  | 'WORKSHOP'
  | 'APPLICATION_STATUS'
  | 'DOCUMENT_REQUEST'
  | 'POLICY_DEADLINE'

export const MESSAGE_PURPOSES: MessagePurpose[] = [
  'MARKETING',
  'TRANSACTIONAL',
  'SERVICING',
  'APPOINTMENT',
  'RELATIONSHIP',
  'BIRTHDAY',
  'WORKSHOP',
  'APPLICATION_STATUS',
  'DOCUMENT_REQUEST',
  'POLICY_DEADLINE',
]

export type ConsentPurpose =
  | 'TRANSACTIONAL_SMS'
  | 'MARKETING_SMS'
  | 'TRANSACTIONAL_EMAIL'
  | 'MARKETING_EMAIL'
  | 'APPOINTMENT_REMINDERS'
  | 'SERVICE_NOTIFICATIONS'
  | 'WORKSHOP_COMMUNICATIONS'
  | 'BIRTHDAY_COMMUNICATIONS'

export type Channel = 'sms' | 'email'

/**
 * Marketing/promotional purposes require MARKETING consent and carry unsubscribe +
 * marketing quiet-hour/frequency treatment. Purely relationship/servicing/transactional
 * purposes do not (but consent and DNC are STILL enforced independently — an existing
 * relationship never overrides an opt-out; §9 birthday rule).
 */
export function isMarketingPurpose(purpose: MessagePurpose): boolean {
  return purpose === 'MARKETING' || purpose === 'WORKSHOP'
}

/**
 * Marketing-class purposes (MARKETING and WORKSHOP — the `isMarketingPurpose` set — plus BIRTHDAY
 * and RELATIONSHIP, which are proactive relationship outreach). Used for the Sunday-morning hold.
 */
export const QUIET_HOURS_GATED_PURPOSES: MessagePurpose[] = [
  'MARKETING',
  'WORKSHOP',
  'BIRTHDAY',
  'RELATIONSHIP',
]

/**
 * SMS purposes EXEMPT from the 9:00–20:00 floor: notices a person's own action or account event
 * triggers, sent immediately — a transactional receipt, an appointment confirmation/change,
 * application status, a document request. Appointment REMINDERS are scheduled, not immediate:
 * the reminder scheduler moves them inside the floor (owner decision 3), so the gate exemption
 * here covers only the immediate notices.
 */
export const QUIET_HOURS_EXEMPT_PURPOSES: MessagePurpose[] = [
  'TRANSACTIONAL',
  'APPOINTMENT',
  'APPLICATION_STATUS',
  'DOCUMENT_REQUEST',
]

/**
 * Whether the quiet-hours floor (gate step 2) applies to a send. Owner decision 2
 * (docs/ops/automation-inventory.md §10, 2026-10-02) widened the 2026-08-07 scope: the floor
 * covers ALL automated campaign SMS — Life Conversion and term conversion (POLICY_DEADLINE) and
 * SERVICING-tagged campaigns included.
 *   • email — never quiet-hours gated (any purpose);
 *   • SMS with an immediate-notice purpose (QUIET_HOURS_EXEMPT_PURPOSES) — not gated;
 *   • every other SMS purpose, and SMS with NO purpose — gated.
 * Consent, DNC/STOP, the recommendation red-line, and the securities firewall are enforced
 * independently of this scoping and are unaffected by it.
 */
export function quietHoursApply(channel: Channel, purpose?: MessagePurpose | null): boolean {
  if (channel === 'email') return false
  if (!purpose) return true
  return !QUIET_HOURS_EXEMPT_PURPOSES.includes(purpose)
}

/**
 * Marketing SMS is also held until 12:00 recipient-local on SUNDAYS (owner decision 2 — Texas
 * solicitation hours; counsel to confirm). Marketing-class purposes and unclassified SMS.
 */
export function sundayMarketingHoldApplies(channel: Channel, purpose?: MessagePurpose | null): boolean {
  if (channel !== 'sms') return false
  if (!purpose) return true
  return QUIET_HOURS_GATED_PURPOSES.includes(purpose)
}

/**
 * Map a message purpose + channel to the consent purpose that must be granted. Birthday
 * and relationship messages require the configured relationship/birthday permission — an
 * existing customer relationship is NEVER treated as implicit consent (§9). Transactional/
 * servicing/appointment/application/deadline map to their channel-appropriate
 * transactional-or-purpose consent.
 */
export function purposeToConsentPurpose(purpose: MessagePurpose, channel: Channel): ConsentPurpose {
  switch (purpose) {
    case 'MARKETING':
    case 'WORKSHOP':
      // Workshop marketing uses the dedicated workshop-communications consent when set,
      // else marketing consent for the channel. The resolver ORs these; the canonical
      // required grant for a workshop invite is WORKSHOP_COMMUNICATIONS.
      return purpose === 'WORKSHOP'
        ? 'WORKSHOP_COMMUNICATIONS'
        : channel === 'sms'
          ? 'MARKETING_SMS'
          : 'MARKETING_EMAIL'
    case 'BIRTHDAY':
    case 'RELATIONSHIP':
      return 'BIRTHDAY_COMMUNICATIONS'
    case 'APPOINTMENT':
      return 'APPOINTMENT_REMINDERS'
    case 'SERVICING':
    case 'APPLICATION_STATUS':
    case 'DOCUMENT_REQUEST':
    case 'POLICY_DEADLINE':
      return 'SERVICE_NOTIFICATIONS'
    case 'TRANSACTIONAL':
    default:
      return channel === 'sms' ? 'TRANSACTIONAL_SMS' : 'TRANSACTIONAL_EMAIL'
  }
}

/**
 * The §9 default campaign/message priority. LOWER number = HIGHER priority. A
 * lower-priority send pauses when a higher-priority campaign or an active conversation is
 * underway (evaluateCollision, frequency.ts). Active conversation (0) is handled
 * separately as it is not a message purpose.
 */
const PRIORITY: Record<MessagePurpose, number> = {
  // active conversation = 0 (see frequency.ts)
  APPLICATION_STATUS: 1, // service / application requirement
  DOCUMENT_REQUEST: 1,
  SERVICING: 1,
  POLICY_DEADLINE: 2, // time-sensitive term-conversion / deadline
  APPOINTMENT: 3, // confirmed appointment
  TRANSACTIONAL: 3,
  BIRTHDAY: 4,
  RELATIONSHIP: 4,
  WORKSHOP: 5, // annual review / educational tier
  MARKETING: 6, // cross-sell / win-back / long-term nurture
}

/** Priority rank for a purpose (lower = more important). Unknown → lowest priority. */
export function purposePriority(purpose: MessagePurpose): number {
  return PRIORITY[purpose] ?? 99
}

/** True when `candidate` should yield to an in-flight `active` purpose (lower rank wins). */
export function yieldsTo(candidate: MessagePurpose, active: MessagePurpose): boolean {
  return purposePriority(active) < purposePriority(candidate)
}
