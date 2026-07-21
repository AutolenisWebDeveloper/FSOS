# ADR-012 — Compliance Intelligence (NIGO-Resolution) Exception

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering (authorized by the platform owner / licensed FSA)

## Context
CLAUDE.md §5 excludes **NIGO ("Not In Good Order")** work from FSOS. That exclusion is aimed at NIGO **defect-prevention** — prediction/scoring systems that try to pre-empt not-in-good-order outcomes — which is a separate project and stays out of scope.

Independently, on **2026-07-19** the platform owner (the licensed FSA) authorized a distinct, narrowly-scoped **Compliance Intelligence** module for NIGO **resolution**, and it has since shipped: `/app/compliance/intelligence` + `/api/compliance/*`, backed by isolated `compliance_*` / `nigo_cases` / `nigo_issues` tables (migrations `036`, `037`) and the blueprint in `docs/compliance/`.

Two problems motivated this ADR:
1. **§5 as written was a blanket exclusion** ("create no NIGO module … or cross-link"), which literally forbade the owner-authorized module — a contract-vs-as-built contradiction that pre-dated the v2 contract install (the prior contract carried the same blanket wording).
2. **The module's code cited an authorization that did not exist.** Its migration and source comments referenced a *"CLAUDE.md §3 authorized-exception note"* that no version of the contract ever contained — the carve-out was cited but never written down. There was no durable, authoritative record of the authorization or its boundary.

## Decision
The **Compliance Intelligence module (NIGO-resolution)** is an **authorized, isolated exception** to the §5 NIGO exclusion. This ADR is that authorization of record; §5 and §7.2 cite it.

- **Authorization.** Granted by the platform owner (the licensed FSA) on **2026-07-19**. The owner is independent; **no external, third-party, or firm sign-off gates this authorization** — the owner's authorization is the basis. (The §12 FFS communications sign-off applies only to outbound automated client outreach, which this module does not perform — see Boundary.)
- **Scope: NIGO-resolution only.** Retrieval-grounded, citation-backed drafting of responses/rebuttals to not-in-good-order items, produced as **internal drafts the FSA reviews and edits before use**. It also helps harden case notes to the objective standard and check RightBridge paperwork. **NIGO defect-prevention (scoring/prediction) remains out of scope** (§5).
- **Boundary (binding).**
  - **Isolated data.** Its own `compliance_*` / `nigo_cases` / `nigo_issues` tables. **No foreign key into the aggregate-root case spine** (§10); no cross-link that would blur Case Management OS (which stays NIGO-free) with this module.
  - **Securities firewall (§4.1).** The module operates inside the firewall; it stores no substantive securities data and touches no securities recommendation/suitability determination.
  - **No invented data (§4.3).** Every output is grounded in the authority-tagged corpus (`finra-rule-ingestion`); unsupported requests are flagged, never fabricated.
  - **Human-in-the-loop.** Outputs are internal drafts for FSA review/edit. **No autonomous outward dispatch** — the module never sends a client-facing communication on its own (the communications dispatcher, §12, remains the only send path and is not invoked by this module).

## Rationale
- The module is owner-authorized, already shipped, isolated, and adds compliance value (accurate, cited NIGO responses); deleting or exiling it would discard authorized, working capability.
- Anchoring the carve-out in an ADR gives the authorization a **durable, auditable rationale** (§19) that cannot be silently "simplified" away, and lets code and contract cite the **same** source of truth.
- Scoping the §5 exclusion to *defect-prevention* preserves the original intent (no prediction/scoring, no case-spine entanglement) while making room for the authorized resolution aid.

## Alternatives Considered
- **Module leaves the repo (treat as the "separate NIGO project").** Rejected: it is owner-authorized for in-repo use, is already isolated with no case-spine coupling, and reuses the FSOS AI gateway, audit, and design system; moving it out would fragment the architecture (§6) for no compliance benefit.
- **Keep §5's blanket exclusion and treat the module as a standing violation.** Rejected: contradicts an explicit owner authorization and the as-built system; leaves code citing a nonexistent note.
- **Document the exception only in CLAUDE.md prose (no ADR).** Rejected: §19 requires architectural rationale to live in an ADR; a prose-only carve-out is exactly the kind of decision that erodes over time.

## Consequences
**Positive**
- Contract and code agree and cite one authoritative source (this ADR).
- The authorization, its scope, and its boundary are recorded and auditable.
- Case Management OS stays NIGO-free; the securities firewall and no-invented-data guardrails bound the module explicitly.

**Negative / trade-offs**
- FSOS carries another isolated subsystem whose boundary (isolation, no case-spine FK, no autonomous dispatch) must be preserved and tested on every change that touches it.
- The exception must be revisited if the module's scope is ever proposed to expand beyond NIGO-resolution drafting (e.g., any move toward scoring/prediction or autonomous outward dispatch would require a new/superseding ADR).

## Related Documents
- CLAUDE.md §5 (scope exclusions + this authorized exception), §7.2 (`fsos-nigo-intelligence` skill), §4.1 (securities firewall), §4.3 (no invented data), §10 (aggregate-root spine), §19 (ADR index)
- docs/adr/ADR-004-securities-firewall.md
- docs/compliance/ (module blueprint: `FSOS_Compliance_Intelligence_Blueprint.md`, `START_HERE.md`, `objective_standard.md`)
- supabase/migrations/036_compliance_intelligence.sql, 037_compliance_document_pipeline.sql
- `.claude/skills/fsos-nigo-intelligence`
