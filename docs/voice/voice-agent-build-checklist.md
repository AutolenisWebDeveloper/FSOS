# FSOS Voice Agent — Build Checklist

September 23, 2026 · Markist Athelus

## How to use this checklist

A stage is complete only when every box in the **universal definition of done** and every box in that stage’s own list is checked. Only then does the next stage start. It follows the 12-stage sequence in the [FSOS Voice Agent — Complete Plan](https://claude.ai/code/artifact/e7390d9f-589f-484f-9d34-8421431954de); screens refer to the [design canvas](https://claude.ai/artifact/5BJZueXJ7654nAqVLpfvQp).

- Each item names who checks it: **Eng**, **QA**, **Design**, **Compliance**, **Counsel**, **Principal** (supervision) or **Ops** (district operator).
- Every item gets one status: PASS, FAIL, BLOCKED or N/A. PASS needs evidence (a merged PR, a passing CI run, a browser run, a signed approval or a dashboard link) linked in a comment on the item. BLOCKED names the outside owner and the decision needed. NOT VERIFIED never counts as PASS.
- A stage is NOT COMPLETE while any item is FAIL, BLOCKED or NOT VERIFIED, any P0 defect is open, any exit criterion failed, or a required approval is missing. Code that compiles, renders or passes the happy path is not enough.
- Each stage closes with a filled-in phase completion report (template near the end of this checklist).
- File paths, table names and service names come from the build spec. They haven’t been checked against the FSOS repository; the last section lists what to confirm first.

## Universal definition of done (every stage)

Every stage must pass all of these on top of its own list. They come from the FSOS project rules and the build spec.

**Architecture and code**

- [ ] Existing FSOS services, components and utilities reused or extended; no duplicate API, send path or state store (Eng)
- [ ] TypeScript strict mode; no `any` in new code; public functions typed and documented (Eng)
- [ ] Every tool the model can request is schema-validated and passes the policy engine: identity, permission, consent, workflow state, parameters (Eng)
- [ ] Every outbound call, text or voicemail goes through `sendThroughGate`; no other path (Eng + Compliance)
- [ ] Idempotency key on every write tool; retries can’t double-book or double-send (Eng)
- [ ] Code review by a second engineer; security-sensitive changes reviewed by the security owner (Eng)
- [ ] No prohibited tool or capability exists: recommendInvestment, recommendAnnuity, selectProduct, determineSuitability, moveMoney, changeBeneficiary, approveUnderwriting, or any NIGO workflow (Eng + Compliance)
- [ ] Every playbook declares its ID, purpose, direction, allowed and prohibited tools, scripts, minimum assurance, consent basis, escalation rules, success outcome, exit rules and version (Eng)

**Data**

- [ ] Database changes shipped as migrations with a tested rollback; no data deleted (Eng)
- [ ] Row-level security by agency on every new table; tests prove cross-agency reads fail (Eng + QA)
- [ ] Audit, turn, tool-request and consent tables stay append-only; update and delete are blocked (Eng)
- [ ] No personal data in logs, traces or error messages (Eng + QA)

**Tests**

- [ ] Unit tests for new logic; integration tests for each tool against a real test database (QA)
- [ ] Scripted-call scenarios for the stage added to the regression suite and passing (QA)
- [ ] Red-team set passing: prompt injection, social engineering, securities bait — 0 violations (QA)
- [ ] Load test at 2× expected peak with p90 voice-to-voice ≤ 1.8 s (QA)
- [ ] Mocked tests and live integration tests reported separately; nothing claimed as passed that wasn’t run (QA)

**Security**

- [ ] Twilio signatures checked on every webhook and WebSocket; unsigned requests rejected and alerted (Eng)
- [ ] Least-privilege roles for the orchestrator and every service; secrets in the secret manager only (Eng)
- [ ] Rate limits on every public endpoint; dependency and container scans clean (Eng)

**UI (FSOS screens)**

- [ ] Built from FSOS design tokens and components; no hard-coded colors, spacing, type, shadows or radii (Design + Eng)
- [ ] Loading, empty, error, degraded, permission-denied and success states; unavailable controls say why; dark mode; responsive layout (Design + QA)
- [ ] WCAG AA: keyboard, focus order, labels, contrast, screen-reader check (QA)

**Compliance and supervision**

- [ ] Every new script, answer and template approved in Change approvals before it goes live (Compliance)
- [ ] AI governance register updated: components, versions, owner, test evidence (Compliance)
- [ ] Supervision queue receives this stage’s flags; principal has reviewed a sample (Principal)

**Operations**

- [ ] Dashboards and alerts for the stage live; on-call runbook written and tested (Ops + Eng)
- [ ] Feature flag per office; instant off switch tested; rollback plan written (Eng)
- [ ] Released behind a feature flag: shadow where it applies, canary, then expand with guardrails; previous version ready for one-step rollback. The minimum release path ships in stage 1; the full Releases screen in stage 12 (Eng + Ops)
- [ ] FSA and staff guide updated; team trained on anything new they will see (Ops)

## Stage 0 — Foundations (weeks 0–2)

Nothing customer-facing ships. This stage builds the platform every later stage uses.

**Accounts, vendors and decisions**

- [ ] Twilio Predictive and Generative AI/ML Features Addendum accepted (Ops)
- [ ] Twilio written confirmation of ConversationRelay max call length, concurrency limit and data locations (Ops)
- [ ] Separate Twilio subaccounts for development, staging and production; test numbers bought (Eng)
- [ ] Decision per office: port the number or keep forwarding; porting orders submitted (Ops)
- [ ] Anthropic commercial terms and data retention reviewed against firm procedures and GLBA (Compliance)
- [ ] Vendor terms confirm no voiceprints from FSOS calls (Compliance)

**Infrastructure**

- [ ] Orchestrator service on the container runtime (ECS Fargate or Fly.io) with health checks and autoscaling on active sessions (Eng)
- [ ] Load balancer with WebSocket support and idle timeout sized for long calls (Eng)
- [ ] Redis for session snapshots, idempotency keys and rate limits (Eng)
- [ ] TwiML webhooks on Vercel: `/voice/inbound`, `/voice/connect-action`, `/voice/status` (Eng)
- [ ] Number fallback URL goes straight to the office ring group if FSOS is down (Eng)
- [ ] OpenTelemetry tracing per call turn; log pipeline with personal data redaction (Eng)
- [ ] CI/CD with staging deploy, blue/green production deploy and a drain for live calls (Eng)

**Database (Supabase Postgres)**

- [ ] `voice` schema migrations: `calls`, `call_turns`, `llm_calls`, `tool_invocations`, `consent_records`, `dispositions`, `summaries`, `transfers`, `audit_log` (Eng)
- [ ] Append-only triggers on audit, turns, tool requests and consent; hash chain on `audit_log` (Eng)
- [ ] Agency row-level security and a dedicated orchestrator role limited to approved functions (Eng)
- [ ] Write-once archive bucket (object lock) and hourly hash-chain export (Eng)

**Voice and model core**

- [ ] WebSocket upgrade checks `X-Twilio-Signature`; URL format verified in staging; one connection per call (Eng)
- [ ] ConversationRelay message handling: setup, prompt, interrupt, dtmf, error in; text, play, sendDigits, language, end out; outgoing frames schema-checked (Eng)
- [ ] `LlmProvider` interface with the Claude adapter (streaming, tool use, prompt caching above Haiku 4.5’s 4,096-token minimum), fallback model and timeouts (Eng)
- [ ] Policy engine skeleton: every tool request logged as requested → validated or denied → executed or failed (Eng)
- [ ] Speech sanitizer and output guard (no markdown, URLs or advice wording spoken) (Eng)
- [ ] Per-call state machine and turn manager with barge-in handling (Eng)

**Exit**

- [ ] A signed test call reaches Claude in staging, speaks a scripted line, and every turn appears in the audit log (QA)
- [ ] An unauthorized tool request is denied by FSOS and the denial is in the audit log (QA)
- [ ] The fallback model answers when the primary times out (QA)
- [ ] A controlled failure (model outage, dropped WebSocket) reaches the office ring group (QA)

## Stage 1 — Inbound receptionist + appointment scheduling (weeks 2–8)

Workflows: new inbound lead, appointment scheduling, referral (inbound), stop requests on inbound calls.

**Call handling**

- [ ] Opening disclosure DISC-v3 plays in full and can’t be interrupted; recording starts before it (Eng)
- [ ] “Are you a person?” answered truthfully by a fixed rule, outside the model (Eng)
- [ ] “Representative”, “agent” or keypad 0 transfers at any point (Eng)
- [ ] Relay (TTY/711) handling: longer pauses, keypad options, quick human route (Eng)
- [ ] Three misunderstandings in a row offer a person (Eng)
- [ ] Office hours, holidays and after-hours message from settings (Eng)
- [ ] Approved-answer retrieval: only approved, unexpired answers; no match → “I don’t have that” + follow-up offer (Eng)
- [ ] Securities firewall active from day one: rules, classifier, forced script S-SEC-01 (Eng)
- [ ] Stop request on an inbound call recorded at once with `recordSuppression` and confirmed with S-REVOKE-01 (Eng)

**Tools**

- [ ] `findLead`, `createOrUpdateContact` (duplicate match, no overwrite of verified fields) (Eng)
- [ ] `qualifyLead` with the approved question set, answers stored as fields (Eng)
- [ ] `getAppointmentAvailability` from the real FSOS calendar with booking rules (notice, buffer, daily cap, licensed-rep time) (Eng)
- [ ] `scheduleAppointment` with slot lock and double-booking protection (Eng)
- [ ] `createFollowUpTask` for anything the AI can’t finish (Eng)
- [ ] `sendApprovedSMS` for booking confirmations through `sendThroughGate` (Eng)

**Protection**

- [ ] Per-number caller rate limit, known-robocall screening, per-office concurrency limit (Eng)
- [ ] Daily AI spend cap per office; at the cap the AI pauses and calls ring the office (Eng)
- [ ] Pause AI answering with a required reason, logged (Eng)

**Screens**

- [ ] Live calls, including empty, loading, error, paused and fallback states (Eng + Design)
- [ ] Agent settings, Knowledge & scripts, Change approvals with four-eyes approval live before any script goes live, Launch readiness (Eng)
- [ ] Minimum release path: feature flag per office, canary to one office, one-step rollback, tested once end to end (Eng + Ops)
- [ ] Phone numbers & routing, Calendar, Contacts, Import contacts (Eng)

**Sign-offs**

- [ ] Disclosure, FAQ answers, qualification questions and all scripts approved (Compliance)
- [ ] Recording-consent wording approved for all-party-consent states (Counsel)
- [ ] Import consent-source rules approved (Compliance)

**Exit criteria**

- [ ] ≥ 90% task success on 150 scripted inbound calls (QA)
- [ ] 0 compliance violations in the red-team set (QA)
- [ ] p90 voice-to-voice ≤ 1.8 s at 2× peak (QA)
- [ ] Two-week after-hours pilot at one office with no unresolved supervision items (Principal)

## Stage 2 — Known-client recognition + FSOS context (weeks 6–10)

Workflows: existing client, case-status calls, inbound service.

**Identity**

- [ ] AL1: caller number matches a client contact and carrier attestation is `TN-Validation-Passed-A` (Eng)
- [ ] AL2 step-up by keypad (date of birth + ZIP or policy last four) or a one-time code to the number on file (Eng)
- [ ] Keypad digits captured by the orchestrator, never sent to the model, redacted in transcripts (Eng)
- [ ] Three failed attempts → script S-AUTH-02 and transfer (Eng)
- [ ] Third parties (spouse, child, POA) stay at AL0 unless listed as authorized and verified themselves (Eng)
- [ ] Tool results filtered by assurance level on the server before the model sees them (Eng)

**Tools and data**

- [ ] `findClient` returns only match status and a token below AL2 (Eng)
- [ ] `getCaseStatus` reads approved fields live from the policy system; data older than 24 hours isn’t spoken (Eng)
- [ ] `rescheduleAppointment` and `cancelAppointment` for the caller’s own appointments (Eng)
- [ ] `createServiceCase` with fixed categories; beneficiary, payment and address changes route to a person (Eng)
- [ ] Read-only policy-system integration with timeouts and a clear “can’t confirm right now” path (Eng)
- [ ] Licensing and on-duty roster synced from the firm’s system (Eng)
- [ ] Trusted contact field on contacts (Eng)

**Screens**

- [ ] Contact profile with masked details and “show full details” that requires a reason and is logged (Eng)
- [ ] Consent & DNC, Team & licensing (Eng)

**Sign-offs**

- [ ] What may be disclosed at each assurance level approved (Compliance)
- [ ] Case-status fields and wording approved (Compliance)

**Exit criteria**

- [ ] 0 disclosures above assurance level in 500 test calls, including 50 impersonation attempts (QA)
- [ ] Stale-data rule verified: an old deadline is never spoken (QA)
- [ ] Georgetown (forwarded number) correctly falls back to AL0 until ported (QA)

## Stage 3 — Human transfer + live handoff summaries (weeks 8–12)

Workflow: human transfer, plus the callback queue that catches missed transfers.

**Transfer mechanics**

- [ ] `transferToFSA` resolves an on-duty target in order: assigned FSA → office ring group → voicemail + callback task (Eng)
- [ ] Securities topics go only to registered, on-duty reps, checked against the roster before dialing (Eng)
- [ ] Orchestrator sends `end` with an opaque transfer ID; `/voice/connect-action` builds `<Dial>` from it (Eng)
- [ ] Whisper summary played to the FSA before connecting: who, verified level, reason, what the AI did and didn’t say (Eng)
- [ ] Recording notice repeated on the new leg (Eng)
- [ ] No answer → office voicemail, high-priority task, callback item with owner and due time (Eng)
- [ ] Dropped WebSocket → one reconnect attempt, then straight to the ring group (Eng)

**Queues and alerts**

- [ ] Callbacks & voicemail queue with owner, due time, transcript and outcome (Eng)
- [ ] FSA mobile: incoming transfer screen with Accept, licensed-rep queue and decline (Eng)
- [ ] Notifications: transfers, due callbacks, deadlines; quiet hours; no client details on the lock screen (Eng)
- [ ] Live calls: Listen in and Take over (Eng)

**Sign-offs**

- [ ] Whisper summary template approved (Compliance)
- [ ] Transfer rules for securities approved (Principal)

**Exit criteria**

- [ ] ≥ 98% correct transfer targets; 100% of securities transfers to registered reps (QA)
- [ ] Median transfer connect time ≤ 20 s at the pilot office (QA)
- [ ] Callback SLA met for two weeks (Ops)

## Stage 4 — Call logging, transcription, outcome extraction (weeks 9–14)

Applies to every call from here on. Ends with the go/no-go for one office, all hours.

**Records**

- [ ] `logCall` writes the call record at end of call: numbers, office, assurance level, disposition, model and prompt versions (Eng)
- [ ] Every turn stored with redacted text and what the caller actually heard (`tokens-played`) (Eng)
- [ ] Dual-channel recording linked to the call; recording and transcript exported to the write-once archive (Eng)
- [ ] Retention jobs follow the approved schedule; legal hold overrides deletion (Eng)

**Extraction**

- [ ] `createCallSummary` with template summary-v4 after the call (Eng)
- [ ] `extractCallOutcome` into `voice.call_outcomes`: intent, result, follow-ups, consent change, complaint flag, securities flag, confidence (Eng)
- [ ] Low-confidence extractions go to human review instead of updating records (Eng)
- [ ] Outcomes create CRM notes and tasks through existing FSOS services, never directly (Eng)

**Supervision**

- [ ] Supervision review queue: firewall handoffs, complaints, consent changes, repeated verification failures, output-guard blocks (Eng)
- [ ] Complaint case flow: detect → case → acknowledgment through the gate → principal’s reportability decision → close (Eng)
- [ ] Vulnerable-caller cues → person + flag; trusted-contact rules enforced (Eng)

**Screens**

- [ ] Call history, Call record (transcript, tool requests, policy decisions, audit trail, recording) (Eng)
- [ ] Supervision review, Complaint case (Eng)
- [ ] FSA sign-in and read-only FSA voice assistant (Eng)

**Sign-offs**

- [ ] Retention schedule and archive approach approved, including SEA 17a-4/FINRA 4511 scope (Counsel)
- [ ] Complaint reportability procedure approved (Compliance)
- [ ] Supervision staffing and review deadlines set (Principal)

**Exit criteria**

- [ ] ≥ 95% extraction accuracy on a 300-call labeled set (QA)
- [ ] Archive verified: 100 random calls restored and hash chain intact (QA)
- [ ] Launch readiness checklist complete; go/no-go signed for one office, all hours (Ops + Compliance + Principal)

## Stage 5 — Appointment reminders + rescheduling (weeks 14–18)

Workflows: appointment reminders, no-show recovery, voicemail. This is the first outbound stage, and it covers informational calls only.

**Outbound core (built once, reused by stages 6–11)**

- [ ] `voice.outreach_intents` table and `createOutreachIntent`; only calendar events and FSOS agents create intents (Eng)
- [ ] `sendThroughGate` extended with the `voice_ai` channel and purpose; checks consent, DNC, reassigned numbers and calling window at dial time (Eng)
- [ ] Calling window from area code and address, stricter wins; Texas hours rule (Eng)
- [ ] Dialer: `calls.create` with async answering-machine detection; pacing per office; max 3 attempts per 7 days (Eng)
- [ ] Outbound opening identifies the office, says it’s an automated AI call and gives the keypad opt-out (Eng)
- [ ] `leaveApprovedVoicemail` only with script VM-INF-2 and a matching consent basis; otherwise hang up and create a task (Eng)
- [ ] Stop on an outbound call suppresses immediately and cancels all queued intents for that purpose (Eng)

**Workflow tools**

- [ ] `confirmAppointment`, plus reschedule and cancel from Stage 2, limited to the appointment the call is about (Eng)
- [ ] No-show recovery intent created when an appointment is marked missed (Eng)

**Screens**

- [ ] Outbound campaigns: appointment confirmations with the gate funnel, skip reasons, dry-run export (Eng)

**Sign-offs**

- [ ] Reminders and no-show recovery classified as informational (Counsel)
- [ ] Outbound opening, opt-out and VM-INF-2 scripts approved (Compliance)

**Exit criteria**

- [ ] Dry run on real data: 0 dials outside calling windows, 0 to DNC or suppressed numbers (QA)
- [ ] Two weeks live at one office with stop requests honored 100% within the call (QA + Principal)
- [ ] Show-rate baseline captured for comparison (Ops)

## Stage 6 — Consent-controlled outbound calling (weeks 18–24)

Workflows: missed-lead callbacks and outbound stop handling. This stage builds the consent and number-reputation base that marketing calls need.

**Consent**

- [ ] Consent inventory: every contact’s basis per channel and purpose (PEC, PEWC, relationship, none), with evidence links (Eng + Compliance)
- [ ] Consent capture flows that create written consent for AI voice, naming the seller (web form, e-sign, registration forms) (Eng)
- [ ] Workflow-level purpose categories in `consent_records` so informational revocations can be scoped (Eng)
- [ ] Designated opt-out methods (keypad, STOP-type keywords, number or website) disclosed in every AI call and text (Eng)
- [ ] Revocations processed immediately; audit shows time from request to suppression (Eng)

**Number reputation**

- [ ] Outbound numbers with A-level STIR/SHAKEN attestation and CNAM registered (Ops + Eng)
- [ ] Numbers registered with the carrier analytics services; spam-label monitoring per number with alerts (Ops)
- [ ] Number pool per office with health tracking; no number rotation to dodge labels (Eng)

**Missed-lead callbacks**

- [ ] Intent created only when the lead called in or asked for a callback; purpose set by the playbook (Eng)
- [ ] Playbook: confirm interest, qualify, schedule; marketing language only with PEWC (Eng)

**Sign-offs**

- [ ] Revocation scope and opt-out methods re-checked after the FCC’s Sept 30, 2026 vote (Counsel)
- [ ] Whether existing consents cover AI voice, or must be re-captured (Counsel)
- [ ] State rule packs (Texas, Florida, Oklahoma and others where you call) (Counsel)

**Exit criteria**

- [ ] Consent inventory covers 100% of contacts in outbound audiences (Compliance)
- [ ] Spam-label monitoring live on every outbound number (Ops)
- [ ] Two weeks of missed-lead callbacks at one office with 0 compliance findings (Principal)
- [ ] Outbound stop and revocation tests pass 100%, including queued-intent cancellation (QA)
- [ ] Counsel’s position on existing consent versus re-capture recorded and applied in the gate (Counsel + Eng)

## Stages 7–11 — Outreach workflows (weeks 24–36)

Each workflow ships as its own stage: 7 annual reviews and life-policy reviews, 8 term conversion, 9 life win-back, 10 workshop follow-up, 11 cross-sell. Each must pass the shared list below plus its own items, repeated per workflow.

**Shared list (copy per workflow)**

- [ ] Playbook in `voice.playbooks`: prompt section, allowed tools, scripts, exit rules, version (Eng)
- [ ] Intents come only from the owning FSOS agent or list; eligibility rules written down and tested (Eng)
- [ ] Counsel classification of the call’s purpose recorded; PEWC required for AI voice if telemarketing (Counsel)
- [ ] All scripts and voicemail approved; no product names, rates, returns or comparisons (Compliance)
- [ ] Firewall bait set for this workflow passes 100% (QA)
- [ ] Dry run on the real audience: gate funnel and skip reasons reviewed; no one dialed (Ops + Compliance)
- [ ] Skipped contacts (no consent) routed to FSAs for human calls, not dropped (Eng)
- [ ] Licensed-rep capacity confirmed for the meetings this workflow books (Ops)
- [ ] Staged rollout: one office, 10% of the audience, then expand with guardrails (Eng + Ops)
- [ ] Meetings booked per 100 calls and opt-out rate tracked against the baseline (Ops)

**7 — Annual reviews and life-policy reviews**

- [ ] Eligibility: clients with no review in 12 months (Eng)
- [ ] Life-policy reviews book only with licensed professionals; any product question is transferred (Eng)

**8 — Term conversion**

- [ ] Intents from the existing `term_conversion` agent; deadline re-read from the policy system at dial time (Eng)
- [ ] AL2 required before any policy fact is spoken; outbound call asks for verification first (Eng)
- [ ] Deadline accuracy 100% against the policy system in the dry run (QA)
- [ ] A missing, stale or expired deadline skips the call; it is never spoken (QA)

**9 — Life win-back**

- [ ] Intents from `marketing_automation` (`winback`); PEWC only; anyone who revoked is excluded (Eng + Compliance)
- [ ] 0 ineligible dials in the dry run (QA)

**10 — Workshop follow-up**

- [ ] Registration form captures PEWC naming the seller before any AI call (Eng + Counsel)
- [ ] Approved logistics answers (date, place, parking, recording of the event) (Compliance)

**11 — Cross-sell**

- [ ] Intents from `marketing_automation` (`cross_sell`) using FSOS-identified opportunities only (Eng)
- [ ] Script invites a meeting with a licensed professional; no product claims (Compliance)
- [ ] The AI never advances an opportunity stage; it only links the call or meeting (Eng + QA)

## Stage 12 — Optimization, QA, supervision (from week 11, permanent)

This stage never closes. Change approvals and the minimum release path already shipped in stage 1. The boxes below must be true before stage 5 starts, and they are re-checked every quarter.

**Quality**

- [ ] Quality review: sampling 5% of AI calls plus every flagged call, with a written rubric (Eng + QA)
- [ ] Scored calls can be added to the test set or turned into a change request in one click (Eng)
- [ ] Test set grows every week from real failures; regression suite runs on every prompt, model or rule change (QA)

**Releases**

- [ ] Releases screen: shadow → 10% → 50% → 100% with automatic rollback on firewall miss, transfer failures \> 2%, p90 \> 2.0 s or a jump in callers asking for a person (Eng)
- [ ] Model IDs pinned by date; every model change re-runs the full suite (Eng)
- [ ] Changes need approval from someone other than the requester (Eng + Compliance)

**Measurement**

- [ ] Analytics: volumes, resolved by AI, handoff reasons, abandonment, latency, cost per call, per-office and per-workflow outcomes (Eng)
- [ ] Outcome metrics per workflow: meetings booked, show rate, conversions completed before deadline (Ops)

**Governance**

- [ ] AI governance register current: components, versions, owners, vendor reviews, test evidence (Compliance)
- [ ] Regulator package export works and was dry-run once (Compliance)
- [ ] Quarterly governance review signed (Compliance + Principal)

## Evidence labels

Use these in every phase completion report so a reader knows what kind of proof backs each PASS.

| Label                | Means                                                        |
|----------------------|--------------------------------------------------------------|
| CODE-VERIFIED        | Code review confirms the control exists                      |
| TEST-VERIFIED        | An automated or scripted suite passed, with the run linked   |
| INTEGRATION-VERIFIED | A real or controlled integration proved the dependency works |
| BROWSER-VERIFIED     | The screen flow was checked end to end in a browser          |
| COMPLIANCE-VERIFIED  | The required approval is recorded                            |
| EXTERNAL-DEPENDENCY  | Blocked on an outside decision with a named owner            |
| NOT VERIFIED         | No acceptable evidence; a mandatory item cannot pass         |

## Workflow traceability

| \#  | Workflow               | Stage                 | Direction                              | Identity                   | Consent for AI voice                              |
|-----|------------------------|-----------------------|----------------------------------------|----------------------------|---------------------------------------------------|
| 1   | New inbound lead       | 1                     | Inbound                                | AL0                        | None (caller initiated)                           |
| 2   | Existing client        | 2                     | Inbound                                | AL1–AL2                    | None                                              |
| 3   | Missed lead            | 6                     | Outbound                               | AL0                        | PEC if returning their inquiry; PEWC if marketing |
| 4   | Appointment scheduling | 1                     | Both                                   | AL0 new, AL1 existing      | PEC                                               |
| 5   | Appointment reminders  | 5                     | Outbound                               | AL1                        | PEC                                               |
| 6   | Annual reviews         | 7                     | Outbound                               | AL1                        | Likely PEWC (counsel)                             |
| 7   | Life-policy reviews    | 7                     | Both                                   | AL1                        | Likely PEWC if outbound (counsel)                 |
| 8   | Term conversion        | 8                     | Both                                   | AL2 before any policy fact | Likely PEWC if outbound (counsel)                 |
| 9   | Life win-back          | 9                     | Outbound                               | AL0–AL1                    | PEWC                                              |
| 10  | Cross-sell             | 11                    | Outbound                               | AL1                        | PEWC                                              |
| 11  | Workshop follow-up     | 10                    | Outbound                               | AL0                        | PEWC on the registration form                     |
| 12  | Referral follow-up     | 1                     | Inbound AI; first outbound by a person | AL0                        | No AI outbound                                    |
| 13  | No-show recovery       | 5                     | Outbound                               | AL1                        | PEC                                               |
| 14  | Case-status calls      | 2                     | Inbound                                | AL2                        | None                                              |
| 15  | Inbound service        | 2                     | Inbound                                | AL1 for account items      | None                                              |
| 16  | Human transfer         | 3                     | Both                                   | Any                        | n/a                                               |
| 17  | Voicemail              | 5                     | Outbound                               | n/a                        | Same as the call it follows                       |
| 18  | DNC / stop request     | 1 inbound, 6 outbound | Both                                   | None                       | n/a                                               |

## Screen traceability

| Screen                                                         | First needed                                                          |
|----------------------------------------------------------------|-----------------------------------------------------------------------|
| How a call flows, Workflows & production sequence              | Reference, all stages                                                 |
| Empty, loading, error, degraded and permission-denied states   | Every stage with screens                                              |
| Live calls, Calendar, Agent settings, Knowledge & scripts      | Stage 1                                                               |
| Change approvals, Launch readiness, Releases (minimum path)    | Stage 1                                                               |
| Phone numbers & routing, Contacts, Import contacts             | Stage 1                                                               |
| Contact profile, Consent & DNC, Team & licensing               | Stage 2                                                               |
| Incoming AI transfer, FSA notifications, Callbacks & voicemail | Stage 3                                                               |
| Call history, Call record, Supervision review, Complaint case  | Stage 4                                                               |
| FSA sign-in, FSA voice assistant (read-only)                   | After stage 4                                                         |
| Outbound campaigns                                             | Stage 5 (appointment confirmations), then one campaign per stage 6–11 |
| Opportunities                                                  | Stages 8–11                                                           |
| Analytics, Quality review, AI governance, Releases (full)      | Stage 12                                                              |
| Live calls, dark mode                                          | Every stage with screens                                              |

## Phase completion report

Fill this in at the end of every stage and link it from the stage heading.

1.  **Phase and status:** PASS, FAIL or BLOCKED
2.  **Requirements:** completed; not completed; out of scope
3.  **Code:** files added and changed; migrations; tools and APIs; playbooks
4.  **Screens:** screens built; states built; differences from the design
5.  **Security and authorization:** controls verified; failures
6.  **Compliance:** rules verified; approvals obtained; counsel items still open
7.  **Data and audit:** schema; audit events; retention; source-of-record checks
8.  **Tests:** unit, integration, end-to-end, voice scenarios, red team, regression, performance (mocked and live reported separately)
9.  **Failure modes tried:** model outage, tool outage, telephony failure, data-source failure, transfer failure
10. **Exit criteria:** each one with PASS or FAIL and its evidence label
11. **Open items:** P0, P1, outside dependencies
12. **Final determination:** PHASE COMPLETE or PHASE NOT COMPLETE

## Verify against the FSOS repository first

This checklist was written from the spec and designs, not the FSOS code. Confirm these before Stage 0 starts, and fix any item above that turns out wrong.

- [ ] Where `sendThroughGate` lives, its signature, and how to add the `voice_ai` channel without a second path (Eng)
- [ ] How `term_conversion` and `marketing_automation` agents emit work today, and how they will emit outreach intents (Eng)
- [ ] The FSOS calendar source and booking API (Eng)
- [ ] Existing contact, consent, task and note tables to extend rather than duplicate (Eng)
- [ ] Supabase project, auth claims (agency ID) and current row-level security pattern (Eng)
- [ ] FSOS design tokens, component library and dark-mode approach (Design + Eng)
- [ ] Existing Twilio numbers, messaging service and A2P 10DLC campaign (Ops + Eng)
- [ ] Current hosting (Vercel project) and where the orchestrator container will run (Eng)
