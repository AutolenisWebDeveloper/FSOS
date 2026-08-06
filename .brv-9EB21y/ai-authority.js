"use strict";
// src/lib/comms/ai-authority.ts
// Slice 5 — AI authority matrix (PURE). Master build instruction §11.
//
// Which AI-generated message CLASSES the autonomous AI may auto-send, which it may only
// DRAFT for human review, and which are BLOCKED. Enforced "through code and message
// classification — not prompts" (§11): the send path classifies the AI message and this
// matrix decides. A draft_only/blocked class is never auto-sent — it is held for the
// human FSA. This is a pure decision (no DB) so it is unit-testable offline
// (tests/comms-ai-authority.test.mjs) and is the authoritative source for the wiring.
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateAiAuthority = evaluateAiAuthority;
exports.mayAutoSend = mayAutoSend;
const AUTO_SEND = new Set([
    'approved_first_touch',
    'scheduled_campaign',
    'birthday',
    'appointment_confirmation',
    'appointment_reminder',
    'scheduling_link',
    'receipt_acknowledgment',
    'stop_help_unsubscribe_confirmation',
    'availability_question',
    'approved_thank_you',
]);
const BLOCKED = new Set(['securities_related']);
/**
 * Decide the authority for an AI message class (§11). Securities is blocked (firewall,
 * §4.1); the approved low-risk classes auto-send; everything advisory / policy-specific /
 * pricing / sensitive / case-affecting is draft-only (held for the licensed FSA). An
 * UNKNOWN/unclassified message fails safe to draft_only — the AI never auto-sends
 * something the code could not positively classify as low-risk.
 */
function evaluateAiAuthority(messageClass) {
    if (messageClass && BLOCKED.has(messageClass)) {
        return { authority: 'blocked', reason: 'Securities-related — never sent from FSOS; route to FFS-supervised handling.' };
    }
    if (messageClass && AUTO_SEND.has(messageClass)) {
        return { authority: 'auto_send', reason: `Approved low-risk class "${messageClass}" — may auto-send.` };
    }
    // Every other known class is advisory/sensitive → draft-only; unknown → fail-safe draft.
    return {
        authority: 'draft_only',
        reason: messageClass
            ? `Class "${messageClass}" requires licensed FSA review — drafted, not auto-sent.`
            : 'Unclassified AI message — fail-safe to human review (never auto-sent).',
    };
}
/** Convenience: may this AI message class be auto-sent? (false for draft_only + blocked). */
function mayAutoSend(messageClass) {
    return evaluateAiAuthority(messageClass).authority === 'auto_send';
}
