# Architecture Decision Records (ADR) Index

> Discoverable index of every ADR in `docs/adr/`. ADRs are **authoritative for their subject matter** and must be consulted before modifying the associated architecture; do not change an accepted architecture without updating its ADR in the same change (`CLAUDE.md` §19). New decisions use [`ADR-000-template.md`](./ADR-000-template.md). Status values: **Proposed → Accepted → Superseded** (link the superseding ADR).
>
> This index is generated from the files' own headers (title + `**Status:**`). Keep it in sync when adding, renumbering, or superseding an ADR.

## ⚠ Numbering collisions (current reality — cite by slug, do not renumber)

**Four** numbers each currently have **two** files on disk:

- **ADR-015** — `ADR-015-delegated-agency-communication.md` **and** `ADR-015-fna-calculation-engine.md`
- **ADR-016** — `ADR-016-identity-disclosure-engine.md` **and** `ADR-016-fna-data-model.md`
- **ADR-028** — `ADR-028-agent-tool-calling.md` **and** `ADR-028-contact-consolidation-dedup.md`
- **ADR-029** — `ADR-029-life-conversion-campaign.md` **and** `ADR-029-household-materialization.md`

**Resolution: all eight documents keep their numbers and are cited by filename slug.** Every one of the four numbers has live inbound references from code comments, migrations, tests, other ADRs, and installed skills, so renumbering would break existing citations rather than clarify them. `CLAUDE.md` §19 indexes all eight and records the same convention.

**When citing a colliding ADR, write the slug** — `ADR-028-agent-tool-calling.md`, not "ADR-028". A bare number in these four ranges is ambiguous and must be read from context. **Do not** renumber or move any ADR file as part of reading this index.

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
| 012 | Compliance Intelligence (NIGO-Resolution) Exception | Superseded by 040 | [`ADR-012-compliance-intelligence-exception.md`](./ADR-012-compliance-intelligence-exception.md) |
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
| 026 | Social Content Module | Accepted | [`ADR-026-social-content-module.md`](./ADR-026-social-content-module.md) |
| 027 | Native FSOS Booking (Calendly replacement) | Accepted | [`ADR-027-native-booking.md`](./ADR-027-native-booking.md) |
| 028 ⚠ | Governed Agent Tool-Calling **(⚠ shares 028 — cite by slug)** | Accepted | [`ADR-028-agent-tool-calling.md`](./ADR-028-agent-tool-calling.md) |
| 028 ⚠ | Contact Consolidation, Dedup Strategy & Staging Reconciliation **(⚠ shares 028 — cite by slug)** | Accepted | [`ADR-028-contact-consolidation-dedup.md`](./ADR-028-contact-consolidation-dedup.md) |
| 029 ⚠ | Life Conversion Campaign (multi-channel timeline + Active Opportunity Ownership) **(⚠ shares 029 — cite by slug)** | Accepted | [`ADR-029-life-conversion-campaign.md`](./ADR-029-life-conversion-campaign.md) |
| 029 ⚠ | Household Materialization (contact → household spine) **(⚠ shares 029 — cite by slug)** | Accepted | [`ADR-029-household-materialization.md`](./ADR-029-household-materialization.md) |
| 030 | Contact Segmentation (the targeting layer) | Accepted | [`ADR-030-contact-segmentation.md`](./ADR-030-contact-segmentation.md) |
| 031 | Pipeline Win-Back Campaign (stalled internal-opportunity re-engagement) | Accepted | [`ADR-031-pipeline-winback-campaign.md`](./ADR-031-pipeline-winback-campaign.md) |
| 032 | Cross-Sell Life Campaign (existing-client, no-active-life; 35-touch timeline) | Accepted | [`ADR-032-cross-sell-life-campaign.md`](./ADR-032-cross-sell-life-campaign.md) |
| 033 | Communications Command Console (orchestration over the one send path) | Accepted | [`ADR-033-communications-console.md`](./ADR-033-communications-console.md) |
| 034 | Life Win-Back Agent (first-class win-back outreach) | Accepted | [`ADR-034-life-winback-agent.md`](./ADR-034-life-winback-agent.md) |
| 035 | Accessibility / Responsive Verification via a Manual Pre-Ship Checklist | Accepted | [`ADR-035-a11y-preship-checklist.md`](./ADR-035-a11y-preship-checklist.md) |
| 036 | Contact Import: Field Recognition & Mapping Model | Accepted | [`ADR-036-contact-import-mapping-model.md`](./ADR-036-contact-import-mapping-model.md) |
| 037 | Communication Template Version History (database-enforced copy retention) | Accepted | [`ADR-037-comm-template-version-history.md`](./ADR-037-comm-template-version-history.md) |
| 040 | Compliance Intelligence Excision (supersedes 012; retained schema map) | Accepted | [`ADR-040-compliance-intelligence-excision.md`](./ADR-040-compliance-intelligence-excision.md) |

**Note:** ADR-011 has no file (the sequence skips it). `CLAUDE.md` §19 indexes all 41 ADRs including both documents of each colliding pair; cite a colliding ADR by filename slug, never by bare number.
