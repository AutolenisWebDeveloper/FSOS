# FSOS Part 2 — Page Specs: Marketing & Comms · AI Operations · Compliance

> Override specs on top of `../archetypes.md`. These modules render the guardrails as visible controls: the comms dispatcher gate, the AI green-zone/red-line boundary, the securities firewall, and consent/quiet-hours/DNC enforcement.

---

## OS-12 Marketing & Communications

Every automated send passes the 7-step dispatcher gate (`../data-guardrails.md` §5) before dispatch. The UI never offers a way to bypass it.

### Unified Communication Timeline
- **Route/Archetype/Roles:** `/app/comms` · A2-timeline · fsa, licensed_staff
- **Data:** all SMS/email/logged interactions across households/agencies, direction, channel, template/campaign, delivery status, consent-at-send.
- **Filters:** channel, direction, entity, campaign, delivery status (sent|delivered|failed|blocked). **Search:** recipient, content snippet.
- **Compliance:** blocked messages appear with reason (not hidden); no "force send" control. **Audit:** view logged.
- **Acceptance:** every message shows the consent + gate result at send time.

### SMS / Email Inbox
- **Routes/Archetype:** `/app/comms/sms`, `/email` · A2
- **Actions:** reply (through gate), assign to record, mark handled. Inbound STOP/opt-out auto-updates `consents`/DNC before next send.
- **Acceptance:** replying to a securities-flagged thread is blocked + escalated; opt-out is honored immediately.

### Templates / Template Editor
- **Routes/Archetype:** `/app/comms/templates` (A2), `/templates/[id]` (A5)
- **Data:** template + channel + category (appointment|referral|agency|term-conversion|policy-review|event|educational) + approval status + version history.
- **Compliance:** templates are pre-approved; the editor blocks recommendation language and requires disclosure/opt-out tokens. Term-conversion/cross-sell templates are education/invitation only.
- **Approval/versioning:** draft → submitted → approved; only approved templates are sendable; changes create a new version (old retained).
- **Audit:** create/edit/approve logged. **Acceptance:** an unapproved template cannot be used by any campaign or agent; every template renders an opt-out/consent footer token.

### Campaigns / Campaign Builder / Campaign Detail
- **Routes/Archetype:** `/app/comms/campaigns` (A2), `/new` (A6 builder), `/[id]` (A3)
- **Builder steps:** audience (from audience builder / segment) → approved template(s) → schedule/cadence → consent + quiet-hours confirmation → review → activate.
- **Compliance:** at activation and at each send, the gate runs per recipient; securities-flagged and DNC/consent-invalid recipients are auto-suppressed and reported.
- **AI:** Marketing Automation agent runs approved campaigns automatically when guardrails pass; blocked items → escalation.
- **Audit:** activation, each send, each block logged. **Related links:** campaign → enrolled records → per-recipient delivery.
- **Acceptance:** no campaign can send without an approved template + passing gate; suppression report shows who/why excluded.

### Sequences / Audience / Suppression / Delivery / Analytics
- **Routes/Archetype:** A2/A5/A2/A2/A11
- **Suppression & opt-out:** master DNC + per-channel opt-outs; authoritative over every campaign/agent. **Delivery:** sent/delivered/failed/blocked with retry (idempotent) + failed-message handling. **Analytics:** send/response/opt-out rates.
- **Audit:** suppression changes + deliveries logged. **Acceptance:** suppression always wins; failed sends retry without duplicating; blocked never silently dropped.

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
