"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGE_PURPOSES = void 0;
exports.isMarketingPurpose = isMarketingPurpose;
exports.purposeToConsentPurpose = purposeToConsentPurpose;
exports.purposePriority = purposePriority;
exports.yieldsTo = yieldsTo;
exports.MESSAGE_PURPOSES = [
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
];
/**
 * Marketing/promotional purposes require MARKETING consent and carry unsubscribe +
 * marketing quiet-hour/frequency treatment. Purely relationship/servicing/transactional
 * purposes do not (but consent, DNC, and quiet hours are STILL enforced independently —
 * an existing relationship never overrides an opt-out; §9 birthday rule).
 */
function isMarketingPurpose(purpose) {
    return purpose === 'MARKETING' || purpose === 'WORKSHOP';
}
/**
 * Map a message purpose + channel to the consent purpose that must be granted. Birthday
 * and relationship messages require the configured relationship/birthday permission — an
 * existing customer relationship is NEVER treated as implicit consent (§9). Transactional/
 * servicing/appointment/application/deadline map to their channel-appropriate
 * transactional-or-purpose consent.
 */
function purposeToConsentPurpose(purpose, channel) {
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
                    : 'MARKETING_EMAIL';
        case 'BIRTHDAY':
        case 'RELATIONSHIP':
            return 'BIRTHDAY_COMMUNICATIONS';
        case 'APPOINTMENT':
            return 'APPOINTMENT_REMINDERS';
        case 'SERVICING':
        case 'APPLICATION_STATUS':
        case 'DOCUMENT_REQUEST':
        case 'POLICY_DEADLINE':
            return 'SERVICE_NOTIFICATIONS';
        case 'TRANSACTIONAL':
        default:
            return channel === 'sms' ? 'TRANSACTIONAL_SMS' : 'TRANSACTIONAL_EMAIL';
    }
}
/**
 * The §9 default campaign/message priority. LOWER number = HIGHER priority. A
 * lower-priority send pauses when a higher-priority campaign or an active conversation is
 * underway (evaluateCollision, frequency.ts). Active conversation (0) is handled
 * separately as it is not a message purpose.
 */
const PRIORITY = {
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
};
/** Priority rank for a purpose (lower = more important). Unknown → lowest priority. */
function purposePriority(purpose) {
    return PRIORITY[purpose] ?? 99;
}
/** True when `candidate` should yield to an in-flight `active` purpose (lower rank wins). */
function yieldsTo(candidate, active) {
    return purposePriority(active) < purposePriority(candidate);
}
