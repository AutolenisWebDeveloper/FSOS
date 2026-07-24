# FSOS Part 2 — Page Specs: Marketing & Comms · AI Operations · Compliance

> Override specs on top of `../archetypes.md`. These modules render the guardrails as visible controls: the comms dispatcher gate, the AI green-zone/red-line boundary, the securities firewall, and consent/quiet-hours/DNC enforcement.

---

## OS-12 Marketing & Communications

Every automated send passes the **13-step dispatcher gate** (`../data-guardrails.md` §5 — the canonical enumeration; pure core `src/lib/comms/gate.ts`, wired by `dispatcher.ts`) before dispatch. The UI never offers a way to bypass it. The gate grew from its original 7 checks to 13 ordered steps as the **Native Communications Platform** (Slices 1–8) was built in-place under `src/lib/comms/*` and `/app/comms/*` — GoHighLevel stays frozen (ADR-014); the `comm_*` model is canonical (ADR-013).

### AI Communications Center (Overview)
- **Route/Archetype/Roles:** `/app/comms` · A2 (ListShell operational overview) · fsa, licensed_staff
- **Slice 9A rebuild:** `/app/comms` is no longer a raw "unified timeline" — it is the **AI Communications Center overview**: an operational-state-at-a-glance dashboard (`src/app/(fsa)/app/comms/page.tsx`). Config-safe stat tiles (active campaigns, pending template approvals, open conversations / recent replies, assignment-review depth, delegation exceptions, suppression, delivery failures, quiet-hour/frequency deferrals, sent-today) each deep-link to the surface that resolves them, above a recent-messages table. In-hub grouped sub-navigation lives in `comms/layout.tsx` via `CommsSubnav` (see `DESIGN.md`).
- **Data:** `comm_messages` (direction, channel, delivery status, `blocked_step`, consent-at-send) + counts across `comm_campaigns`, `comm_templates`, `comm_conversations`, `comm_assignment_reviews`, `agency_communication_delegations`, `dnc_entries`.
- **Compliance:** blocked and deferred sends are shown with their gate step (`blocked_step`), never hidden; no "force send" control. **Audit:** view logged.
- **Acceptance:** every tile links to its resolving surface; a message row shows its gate result (blocked step, or consent-on-file, or sent).

### Inbox (two-way) / SMS / Email
- **Routes/Archetype:** `/app/comms/inbox` (A2 list), `/app/comms/inbox/[id]` (A3 thread), `/app/comms/sms`, `/app/comms/email` · A2
- **Two-way inbox (`inbox/`, `inbox/[id]`):** every inbound + outbound message threads into ONE `comm_conversations` row per contact per channel, auto-associated to member/household/agency. The list shows unread counts, linked household, last direction/time, and per-thread flags — `is_security` (purple; never auto-replied) and `ai_autoreply`.
- **Conversation mode (ADR-018, §10):** a genuine customer reply flips that member's `enrolled` campaign enrollments to `paused_for_conversation` (`inbound.ts`), so no "haven't heard back" drip fires after engagement. The drip runner selects only `status='enrolled'`; deferred resume runs the pure `evaluateResume` (`conversation-mode.ts`) on a manual resume, a resolved/closed conversation, or the customer going quiet for the configured window.
- **Actions:** reply (through the gate), assign to record, mark handled. Inbound STOP/opt-out auto-updates `consents`/DNC (via `keywords.ts`) before next send.
- **Acceptance:** replying to a securities-flagged thread is blocked + escalated; opt-out is honored immediately; a reply pauses that contact's promotional automation.

### Templates / Template Editor
- **Routes/Archetype:** `/app/comms/templates` (A2), `/templates/[id]` (A5)
- **Data:** template + channel + category (appointment|referral|agency|term-conversion|policy-review|event|educational) + approval status + version history.
- **Compliance:** templates are pre-approved; the editor blocks recommendation language and requires disclosure/opt-out tokens. Term-conversion/cross-sell templates are education/invitation only.
- **Approval/versioning:** draft → submitted → approved; only approved templates are sendable; changes create a new version (old retained).
- **Audit:** create/edit/approve logged. **Acceptance:** an unapproved template cannot be used by any campaign or agent; every template renders an opt-out/consent footer token.

### Campaigns / Campaign Builder / Campaign Detail
- **Routes/Archetype:** `/app/comms/campaigns` (A2), `/new` (A6 builder), `/[id]` (A3)
- **Builder steps:** audience (from audience builder / segment) → approved template(s) → **message purpose + delegated-sender config** → schedule/cadence → consent + quiet-hours confirmation → **simulation dry-run** → review → activate.
- **Builder config (ADR-022, `campaign-config.ts`):** the builder stores the gate-relevant config earlier slices deferred — a single message `purpose` (§9/§10, drives consent/frequency/priority) and an optional delegated-sender pairing (`represented_agency_owner_id` + the `delegation_id` authorizing the on-behalf-of send). Both are default-permissive: a campaign with neither dispatches exactly as before. `campaignSendConfig` maps the stored row → the gate's SendContext pieces; the actual delegation row is resolved fresh at dispatch (`ownership.ts`).
- **Simulation required before activation (ADR-021, `simulation.ts`):** activation is gated on a recent read-only dry-run. `simulateCampaign` resolves the audience and runs the **same** pure `evaluateGate` per contact (consent, DNC, quiet hours, template approval, securities, delegation, data-confidence), renders bodies, and **never** calls Twilio/Resend or writes messages — "no send" is structural, not a flag. The activate API returns **422 `simulation_required`** unless `comm_campaigns.simulated_at` is recent.
- **Compliance:** at activation and at each send, the gate runs per recipient; securities-flagged and DNC/consent-invalid recipients are auto-suppressed and reported.
- **AI:** Marketing Automation agent runs approved campaigns automatically when guardrails pass; blocked items → escalation.
- **Audit:** activation, each send, each block logged. **Related links:** campaign → enrolled records → per-recipient delivery.
- **Acceptance:** no campaign can send without an approved template + a recent simulation + passing gate; suppression report shows who/why excluded.

### Campaign Library
- **Route/Archetype/Roles:** `/app/comms/library` · A2 (ListShell catalog) · fsa, licensed_staff
- **Data (ADR-023, `library.ts`):** a curated, version-controlled set of pre-built, **compliance-ready** campaign blueprints (not invented Farmers data — §4.3). Every blueprint is green-zone (education/invitation, no recommendation/call-to-action), footer-free (the dispatcher appends the TRAIGA AI-disclosure + opt-out at send time), and purpose-tagged (Slice 7). A claim-bearing blueprint (a conversion deadline, appointment time, coverage/lapse status) declares `makesSpecificClaims` + the stored fields those claims depend on.
- **Compliance:** "Add to templates" seeds a **draft** `comm_templates` row that still passes human approval before any campaign can use it — the approval gate is never bypassed. A gold "starting point, not send-ready" notice frames the surface.
- **Acceptance:** no blueprint is send-ready; instantiating one produces a draft template, not an active campaign; claim-bearing blueprints wire data-confidence at send.

### Email Rendering (author-time, immutable, deterministic — ADR-025)
- **Not a page — a build/author-time pipeline** behind the templates surface. Templates are authored as React Email components under `src/emails/*` and rendered by `npm run templates:build` (`scripts/build-email-templates.ts`) to a **stored** HTML + plaintext pair that flows through the existing immutable DB approval model. The **send path never renders React** (react-email is a devDependency only).
- **Immutable/versioned (migration 061):** `comm_templates` gains `body_text` (the approved plaintext part), `render_sha` (pins the exact approved bytes), and `source_key`. A matching `render_sha` is a no-op (idempotent); changed bytes bump `version` + reset `approval_status` to draft so the exact new bytes are re-reviewed.
- **Deterministic:** `renderEmailTemplate` → `{ html, text, sha }`; `tests/email-determinism.test.mjs` asserts byte-identical output across runs so "approved" pins reproducible bytes.
- **Send:** `sendThroughGate` threads `ctx.bodyText` to `sendEmail`'s multipart `text` slot (same tokens + identity-disclosure prepend as the HTML, but not open/click-instrumented); absent `body_text` → single-part HTML, exactly as before.

### Sequences / Audience / Suppression / Delivery / Analytics
- **Routes/Archetype:** A2/A5/A2/A2/A11
- **Suppression & opt-out:** master DNC + per-channel opt-outs; authoritative over every campaign/agent. **Delivery:** sent/delivered/failed/blocked with retry (idempotent) + failed-message handling. **Analytics:** send/response/opt-out rates.
- **Audit:** suppression changes + deliveries logged. **Acceptance:** suppression always wins; failed sends retry without duplicating; blocked never silently dropped.

### Assignment Review (ownership queue)
- **Route/Archetype/Roles:** `/app/comms/assignments` · A2 · fsa, licensed_staff
- **Data (Slice 1 / ADR-015, `comm_assignment_reviews`):** records whose communication ownership could **not** be confidently resolved (gate step `ownership`). FSOS is the system of record for WHO a message is on behalf of and WHO actually sent it; when ownership is ambiguous the send is **blocked** and routed here, showing the conflicting source data. Two lists: open queue + recently resolved.
- **Delegated on-behalf-of model (ADR-015, `delegation.ts` + `ownership.ts`):** a licensed FSA may communicate ON BEHALF OF an agency owner only under an **ACTIVE, in-scope** delegation (`agency_communication_delegations`; permitted channels/campaign types, effective/expiry window). Authority is checked **fresh** at send (never trusted from an enrollment snapshot) and fails **closed** — an invalid delegation hard-blocks + escalates (gate step `delegation`). No cross-agency contamination: the contact's agency must equal the delegation's agency.
- **Compliance:** there is **no "force send"** — a record leaves the queue only by authorized human resolution. **Audit:** enqueue + each resolution logged.
- **Acceptance:** nothing is sent on ambiguous ownership; resolving a record records who/when/outcome.

### Identity Disclosure (first-contact) config
- **Routes/Archetype/Roles:** `/app/comms/identity` (A2 config + live preview), `identity-editor.tsx` · fsa, licensed_staff (approval per RBAC)
- **Data (Slice 2 / ADR-016, `comm_identity_config`, engine `identity.ts`):** the approved wording the **platform** auto-inserts on first contact — a campaign author never adds it by hand. Shows approval status, a live full/abbreviated preview, and the gold **"config default — verify"** badge while `is_assumption` (the Farmers entity/role label is editable config, never a hard-coded string — §4.3).
- **Invariants:** disclosure is **per channel** (a first email never satisfies the first-SMS requirement); a full intro re-fires after a configured inactivity window; the wording always names the **actual sender AND the represented Farmers agent** and frames the sender as acting on the agent's behalf — never as the customer's own agent, and never implying a product was purchased (§8).
- **Compliance:** while unapproved, first-contact sends are recorded as needing a full introduction but the disclosure is **not** auto-inserted — approve verified wording to enable it. **Audit:** edit/approve logged.
- **Acceptance:** approved disclosure auto-prepends on the required first-touch; unapproved config never silently inserts wording.

---

## OS-12b Native comms platform — cross-cutting gate dimensions (Slices 1–8)

These dimensions are **enforced in code, not prompts** — each is a pure decision core in `src/lib/comms/*` (offline unit-tested) plus a fail-closed DB resolver, wired opt-in into the gate/send path. They surface across the OS-12 pages above; the canonical step order is `../data-guardrails.md` §5.

### Purpose-scoped consent · frequency caps · priority collision (Slice 3 / ADR-017)
- **Purpose (`purpose.ts`):** every automated message is exactly ONE `MessagePurpose`, which maps to the required consent purpose and drives unsubscribe/quiet-hour/frequency/priority treatment. Enforced consent lives on the `consents` spine table; the **per-purpose** axis is the companion `comm_consent_purposes` (`policy-resolver.ts` prefers the scoped row, falls back to channel-wide).
- **Frequency + collision (`frequency.ts`):** `evaluateFrequency` (per-recipient rate caps) and `evaluateCollision` (pause a lower-priority/promotional send when a higher-priority campaign or active conversation is underway) are **operational deferrals**, not compliance violations — held/dropped this cycle, non-escalating, checked LAST (gate steps `business_hours`/`frequency`/`collision`).

### AI authority matrix + communication evaluations (Slice 5 / ADR-019)
- **Authority (`ai-authority.ts`):** a **code-assigned** AI message class → `auto_send | draft_only | blocked`. Low-risk green-zone classes auto-send; advisory/pricing/needs-analysis/replacement/underwriting/complaint/sensitive/financial/case-affecting classes are **draft-only**; securities is **blocked**; an **unknown class fails safe to draft-only**. A prompt cannot make the AI auto-send securities or advice — the decision is a function of the class, not the model output.
- **Evaluations (`evaluations.ts`):** `evaluateOutboundMessage` combines the already-resolved signals (ownership, identity disclosure, purpose+consent, template approval, sensitive-data, unverified-fact) plus the class authority into `mayAutoSend`. `!mayAutoSend` records an `ai_draft` `agent_action`, marks the message blocked, and escalates to the licensed FSA. Evaluations track guardrail false-negatives (a recommendation slipping through = build-blocking).

### Data confidence & source verification (Slice 6 / ADR-020) + claim wiring (Slice 8 / ADR-024)
- **Confidence (`data-confidence.ts`):** a message making a **specific** claim (a term-conversion deadline, a product the contact owns, a lapse/age/appointment status) is sent only when the underlying field is **verified / non-conflicting / above threshold**; otherwise the contact is EXCLUDED and a verification task is raised (gate step `data_confidence`, escalates). A generic invitation needs no verified data and always passes.
- **Claim wiring (`claims.ts` + `claim-resolver.ts`, migration 059):** a campaign/blueprint **declares** the claim fields its message rests on (`conversion_deadline`, `policy_status`, `appointment_at`); the read-only resolver derives each field's verified/conflicting state for one recipient household (fail-closed on a missing/ambiguous value) and `buildDataConfidence` turns it into the gate input. A campaign that declares no claims is never blocked by this step.

*Simulation (ADR-021), delegated-sender/ownership (ADR-015), identity disclosure (ADR-016), conversation mode (ADR-018), builder config (ADR-022), library (ADR-023), and email rendering (ADR-025) are described with their surfaces in OS-12 above.*

---

## OS-15 AI Operations

Where the autonomous system is observed and controlled. Every agent run and action is logged; the Compliance Guardrail is the hard-block layer.

### AI Operations Center
- **Route/Archetype/Roles:** `/app/ai` · A1 · fsa, licensed_staff (super for config)
- **Widgets:** active agents + status, runs today, escalations open (→ queue), blocked actions, token/cost spend, error rate, model routing health.
- **Acceptance:** kill-switch state visible; every widget links to detail; a disabled agent shows as disabled everywhere.

### Agent Directory / Agent Detail
- **Routes/Archetype:** `/app/ai/agents` (A2), `/agents/[id]` (A3)
- **Roster (green-zone; no NIGO agent):** Executive Intelligence, Agency Growth, Agency Activation, Referral Triage, Referral Follow-Up, Pipeline, Cross-Sell, Term Conversion, Case Management, Document Intelligence, Commission Reconciliation, Marketing Automation, Compliance Guardrail (hard-block), Data Quality.
- **Detail data:** mission, tools (permissioned), triggers, schedules, outputs, memory boundaries, confidence thresholds, enable/disable (kill switch), recent runs.
- **Permissions:** editing agent config = super_admin (`/super/ai/*`); FSA can enable/disable + review.
- **Audit:** config + enable/disable logged. **Acceptance:** each agent's allowed tools reflect green-zone only; none has a "recommend product" tool; Compliance Guardrail cannot be disabled without super + audit.

### Runs / Run Detail / Errors / Evaluations
- **Routes/Archetype:** `/app/ai/runs` (A2), `/runs/[id]` (A3), `/errors` (A2), `/evaluations` (A11)
- **Run detail:** inputs, model used, tool calls, output, confidence, cost/tokens, guardrail result, audit link.
- **Acceptance:** every run traceable end-to-end; a blocked action shows the failing rule; evaluations track guardrail false-negatives (a recommendation slipping through = build-blocking defect).

### Escalations Queue
- Specced in `p0-core.md` (P0). Compliance also reads it in P-3.

---

## OS-16 Compliance (FSA subset; full oversight in P-3 portal)

### Compliance Dashboard
- **Route/Archetype/Roles:** `/app/compliance` · A1 · fsa, licensed_staff
- **Widgets:** firewall events, license/appointment status (expiring badges), consent coverage, DNC size, open exceptions, blocked-action count.
- **Acceptance:** each tile links to detail; expiring license within N days badged.

### Securities Firewall
- **Route/Archetype:** `/app/compliance/firewall` · A2
- **Data:** `compliance_events` where firewall triggered (a securities record excluded from automation, a securities send blocked, a pointer created).
- **Compliance:** demonstrates the firewall is working; no securities substantive data shown, only that it was correctly excluded/pointed to FFS.
- **Audit:** view logged. **Acceptance:** every is_security auto-send attempt appears here as blocked+routed; zero securities auto-sends succeed.

### Licenses / Consent / DNC / Exceptions
- **Routes/Archetype:** A2
- **Licenses:** state life/health + securities registrations (SIE/6/7/63/66) with status + expiry; gates product eligibility (an opportunity requiring a registration the FSA lacks is blocked at create).
- **Consent:** per-member per-channel status + source + timestamp. **DNC:** internal + applicable external list. **Exceptions:** blocked actions + overrides (override requires permission + reason + audit).
- **Audit:** all changes logged. **Acceptance:** license lapse disables the dependent product path until renewed; consent/DNC are authoritative over all sends.

---

*The compliance invariants are enforced in three places and must agree: the dispatcher gate (comms), the guardrail validator (AI), and the firewall (data). If any UI control could bypass any of them, that is a build-blocking defect.*

*Next (final Part 2 file): `portals-admin.md` — Agency-Owner, Client, Admin, and Super Admin portal page specs.*
