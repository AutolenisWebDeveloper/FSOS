# Architecture Decision Records (ADR) Index

> Discoverable index of every ADR in `docs/adr/`. ADRs are **authoritative for their subject matter** and must be consulted before modifying the associated architecture; do not change an accepted architecture without updating its ADR in the same change (`CLAUDE.md` §19). New decisions use [`ADR-000-template.md`](./ADR-000-template.md). Status values: **Proposed → Accepted → Superseded** (link the superseding ADR).
>
> This index is generated from the files' own headers (title + `**Status:**`). Keep it in sync when adding, renumbering, or superseding an ADR.

## ⚠ Numbering collisions (current reality — do not renumber here)

Two numbers each currently have **two** files on disk — a comms ADR and an FNA ADR:

- **ADR-015** — `ADR-015-delegated-agency-communication.md` **and** `ADR-015-fna-calculation-engine.md`
- **ADR-016** — `ADR-016-identity-disclosure-engine.md` **and** `ADR-016-fna-data-model.md`

**⚠ numbering collision — see `CLAUDE.md` §19, which assigns 015 = Delegated agency-communication and 016 = First-contact identity disclosure.** The FNA calculation-engine and FNA data-model ADRs collide on those numbers and need renumbering. This index documents current reality accurately; the renumber/move is being handled separately — **do not** renumber or move any ADR file as part of reading this index.

## Index

| # | Subject | Status | File |
|---|---|---|---|
| 000 | Template (ADR authoring template) | Template | [`ADR-000-template.md`](./ADR-000-template.md) |
| 001 | Aggregate Root: Agency Partnership | Accepted | [`ADR-001-aggregate-root.md`](./ADR-001-aggregate-root.md) |
| 002 | Model-Agnostic AI Gateway | Accepted | [`ADR-002-ai-gateway.md`](./ADR-002-ai-gateway.md) |
| 003 | Single Communications Dispatcher | Accepted | [`ADR-003-communications-dispatcher.md`](./ADR-003-communications-dispatcher.md) |
| 004 | Securities Firewall | Accepted | [`ADR-004-securities-firewall.md`](./ADR-004-securities-firewall.md) |
| 005 | One Backend, Six Portals | Accepted | [`ADR-005-portal-architecture.md`](./ADR-005-portal-architecture.md) |
| 006 | Authentication Architecture | Accepted | [`ADR-006-authentication-architecture.md`](./ADR-006-authentication-architecture.md) |
| 007 | Durable Background-Job Architecture | Accepted | [`ADR-007-background-job-architecture.md`](./ADR-007-background-job-architecture.md) |
| 008 | AI Governance | Accepted | [`ADR-008-ai-governance.md`](./ADR-008-ai-governance.md) |
| 009 | Design-System Governance | Accepted | [`ADR-009-design-system-governance.md`](./ADR-009-design-system-governance.md) |
| 010 | Data Ownership & Row-Level Security | Accepted | [`ADR-010-data-ownership-and-rls.md`](./ADR-010-data-ownership-and-rls.md) |
| 012 | Compliance Intelligence (NIGO-Resolution) Exception | Accepted | [`ADR-012-compliance-intelligence-exception.md`](./ADR-012-compliance-intelligence-exception.md) |
| 013 | Canonical `comm_*` Communications Data Model (reconcile the 006 duplication) | Accepted | [`ADR-013-canonical-comm-model.md`](./ADR-013-canonical-comm-model.md) |
| 014 | GoHighLevel Decommission (ordered, data-preservation-first) | Accepted | [`ADR-014-gohighlevel-decommission.md`](./ADR-014-gohighlevel-decommission.md) |
| 015 | Delegated Agency-Communication Authority & Actual-Sender vs Represented-Party Model **(§19-canonical 015)** | Accepted | [`ADR-015-delegated-agency-communication.md`](./ADR-015-delegated-agency-communication.md) |
| 015 ⚠ | FNA Deterministic Calculation Engine **(⚠ numbering collision — see `CLAUDE.md` §19)** | Accepted | [`ADR-015-fna-calculation-engine.md`](./ADR-015-fna-calculation-engine.md) |
| 016 | First-Contact Identity Disclosure Engine **(§19-canonical 016)** | Accepted | [`ADR-016-identity-disclosure-engine.md`](./ADR-016-identity-disclosure-engine.md) |
| 016 ⚠ | FNA Data Model (structured, versioned, immutable, auditable) **(⚠ numbering collision — see `CLAUDE.md` §19)** | Accepted | [`ADR-016-fna-data-model.md`](./ADR-016-fna-data-model.md) |
| 017 | Policy-Engine Extensions: Purpose Classification, Frequency Caps & Priority Collision | Accepted | [`ADR-017-policy-engine-purpose-frequency.md`](./ADR-017-policy-engine-purpose-frequency.md) |
| 018 | Conversation Mode: A Customer Reply Pauses Promotional Automation | Accepted | [`ADR-018-conversation-mode.md`](./ADR-018-conversation-mode.md) |
| 019 | AI Authority Matrix + Communication Evaluations (Code-Enforced) | Accepted | [`ADR-019-ai-authority-evaluations.md`](./ADR-019-ai-authority-evaluations.md) |
| 020 | Data Confidence & Source Verification (No Specific Claim on Unverified Data) | Accepted | [`ADR-020-data-confidence.md`](./ADR-020-data-confidence.md) |
| 021 | Simulation Mode (Safe Dry-Run; Required Before Campaign Activation) | Accepted | [`ADR-021-simulation-mode.md`](./ADR-021-simulation-mode.md) |
| 022 | Campaign + Sequence Builder Config: Message Purpose & Delegated-Sender | Accepted | [`ADR-022-builder-purpose-delegation.md`](./ADR-022-builder-purpose-delegation.md) |
| 023 | Campaign Library (Pre-Built, Compliance-Ready Blueprints) | Accepted | [`ADR-023-campaign-library.md`](./ADR-023-campaign-library.md) |
| 024 | Data-Confidence Claim Wiring for Campaigns (§18) | Accepted | [`ADR-024-data-confidence-claim-wiring.md`](./ADR-024-data-confidence-claim-wiring.md) |
| 025 | Email Rendering: Hybrid React → Stored, Immutable, Deterministic HTML + Plaintext | Accepted | [`ADR-025-email-rendering.md`](./ADR-025-email-rendering.md) |

**Note:** ADR-011 has no file (the sequence skips it). `CLAUDE.md` §19 lists the canonical ADR subjects; where §19 and a filename disagree (the 015/016 collision above), §19's assignment is authoritative for the number.
