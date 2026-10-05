---
name: fsos-outbound-consent-gate
description: Mandatory before touching any outbound calling, voicemail, SMS from calls, outreach intents, the dialer, consent records, DNC or suppression.
---

# FSOS outbound consent gate

Rule: no contact reaches the dialer except through an approved outreach intent evaluated by `sendThroughGate` at dial time. "The number is in the CRM" never means "we may AI-call this person." The FCC treats AI-generated voices as artificial voice under the TCPA.

## voice.outreach_intents (minimum columns)
subject (contact), workflow, purpose (informational | telemarketing), script_id, earliest_at, latest_at, deadline, gate_decision, gate_reason, attempts, status, outcome, created_by (agent or calendar source), agency_id. Only FSOS agents and calendar events create intents; the model cannot.

## Gate checks at dial time (all must pass; persist the skip reason)
contact + agency · workflow enabled (per-office flag, counsel classification recorded) · purpose · channel = `voice_ai` · seller/entity named in consent · consent evidence and status for this channel and purpose (PEC informational, PEWC telemarketing) · revocation · internal DNC · national DNC · reassigned-number check · recipient time zone (area code and address; stricter wins) · calling window (Texas: 9 AM–9 PM Mon–Sat, noon–9 PM Sun; other states per rule packs) · campaign approved · script version approved · attempt count (max 3 per 7 days) · frequency cap · office kill switch · spend cap.

## Stop and revocation
- "Stop calling", keypad opt-out or STOP text → `recordSuppression` immediately, scoped by channel and purpose, cancels queued intents, confirmation S-REVOKE-01, audited with time from request to suppression.
- Revoking telemarketing consent ends all telemarketing. Designated opt-out methods disclosed in every AI call and text.
- Re-check revocation scope and opt-out methods after the FCC's Sept 30, 2026 vote before Stage 6 (counsel).

## Voicemail
Only approved scripts (VM-INF-2 for informational); marketing voicemail only with PEWC; otherwise hang up and create a task.

## Dry run before any live dial
Run the gate on the real audience with dialing disabled; review the funnel and skip reasons (Ops + Compliance). Exit: 0 dials outside windows, 0 to DNC/suppressed/ineligible numbers. Skipped contacts go to FSAs for human calls, not dropped.

## Stages
Stage 5 builds the outbound core (intents, gate channel, dialer with async AMD) for informational calls. Stage 6 adds consent inventory, capture flows, number reputation (A-level attestation, CNAM, spam-label monitoring, no number rotation). Stages 7–11 each need counsel classification and stay flag-off until signed.
