---
name: fsos-outbound-consent-gate
description: Mandatory before touching any outbound calling, voicemail, SMS from calls, outreach intents, the dialer, consent records, DNC or suppression.
---

# FSOS outbound consent gate

Rule: no contact reaches the dialer except through an approved outreach intent evaluated by the dispatch chokepoint at dial time. The chokepoint is `src/lib/messaging.ts` (`sendSms` / `sendEmail`, policy from `resolveDispatchPolicy` and `evaluateGate`); voice is added there as a `voice_ai` channel (`startVoiceCall` via `MessagingDeps.placeCall`). `sendThroughGate` is retired. Never add a second send path (repo-map §2). "The number is in the CRM" never means "we may AI-call this person." The FCC treats AI-generated voices as artificial voice under the TCPA.

## outreach_intents (minimum columns)
subject (contact), workflow, purpose (informational | telemarketing), script_id, earliest_at, latest_at, deadline, gate_decision, gate_reason, attempts, status, outcome, created_by (campaign engine or calendar source). Only the FSOS campaign engines (Life Conversion, Cross-Sell Life, Pipeline Win-Back, workshop comms) and calendar events create intents, per owner decision 7; the model cannot. Table lives in `public` unless the owner chooses a `voice` schema (owner decision pending, C6).

## Gate checks at dial time (all must pass; persist the skip reason)
contact · workflow enabled (its `automation_switches` key; counsel classification recorded) · purpose · channel = `voice_ai` · seller/entity named in consent · consent evidence and status for this channel and purpose (PEC informational, PEWC telemarketing), read from `consents` (`call`), new AI-voice purposes on `comm_consent_purposes` and evidence in `comm_contact_consents` (owner decision pending, C10) · revocation · internal DNC (`dnc_entries`, `call` and `all` rows — `isOnDNC` must be extended to read them) · national DNC and reassigned-number check (new integrations (owner decision pending, C12)) · recipient time zone via `resolveDispatchTimeZone` (ZIP and area code; when they differ the call must be in window in both; an unresolved US number must be in window in every continental zone) · calling window: the FSOS floor 9:00 AM–8:00 PM recipient-local, every day, with no purpose exemption for `voice_ai`; marketing held until noon Sunday; operator windows and state rule packs may narrow it, never widen it · campaign approved · script version approved · attempt count (max 3 per 7 days) · frequency cap · `automation_switches` kill switch · spend cap.

## Stop and revocation
- "Stop calling", keypad opt-out or STOP text → `recordSuppression` immediately (extending `recordChannelOptOut`, `src/lib/comms/opt-out.ts:157`, and `stop-fanout.ts`), scoped by channel and purpose — today an SMS STOP revokes every purpose on the channel; voice scope (owner decision pending, C11) — cancels queued intents, confirmation S-REVOKE-01, audited with time from request to suppression.
- Revoking telemarketing consent ends all telemarketing. Designated opt-out methods disclosed in every AI call and text.
- Re-check revocation scope and opt-out methods after the FCC's Sept 30, 2026 vote before Stage 6 (counsel).

## Voicemail
Only approved scripts (VM-INF-2 for informational); marketing voicemail only with PEWC; otherwise hang up and create a task.

## Dry run before any live dial
Run the gate on the real audience with dialing disabled; review the funnel and skip reasons (Ops + Compliance). Exit: 0 dials outside windows, 0 to DNC/suppressed/ineligible numbers. Skipped contacts go to FSAs for human calls, not dropped.

## Stages
Stage 5 builds the outbound core (intents, the `voice_ai` channel on the chokepoint, dialer with async AMD) for informational calls. Stage 6 adds consent inventory, capture flows, number reputation (A-level attestation, CNAM, spam-label monitoring, no number rotation). Stages 7–11 each need counsel classification and stay flag-off until signed.
