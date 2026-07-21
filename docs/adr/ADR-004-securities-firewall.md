# ADR-004 — Securities Firewall

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
The FSA is securities-licensed and operates under Farmers Financial Solutions (FFS), the supervised broker-dealer. FSOS is an internal practice-management tool, not a broker-dealer system of record. Storing substantive securities data or letting AI touch securities recommendations in an unsupervised system would create serious FINRA/Reg BI exposure and blur the line between FSOS and the FFS-supervised environment.

## Decision
FSOS enforces a **securities firewall**. It is not a broker-dealer system and is not the system of record for securities activity.
- **May store:** that a securities opportunity/case exists (stage, engagement model, referring agency, expected/actual commission) and a non-substantive reference pointer `ffs_case_ref` to the supervised system.
- **May never store:** securities account numbers, order details, suitability determinations, or securities-related client communications.
- Any record with `is_security = true` is excluded from the automated communications engine and routed to human/FFS handling.
- `is_security` is a hard gate checked in both the communications dispatcher and the AI action validator; the UI marks it with the purple firewall marker.

## Rationale
- Keeps FSOS clearly outside the broker-dealer system-of-record boundary; FFS remains the supervised source of truth.
- Prevents the autonomous AI from ever touching a securities recommendation or a suitability call (the red line).
- Makes the boundary visible (purple marker) and enforceable in code, not just policy.

## Alternatives Considered
- **Store full securities data in FSOS** — rejected: duplicates the supervised system, creates supervision gaps and data-at-rest exposure, invites churning/suitability findings.
- **Rely on process/training instead of code gates** — rejected: unenforceable; one automated send is an incident.

## Consequences
**Positive**
- Clean regulatory boundary; reduced examination surface.
- Deterministic exclusion of securities items from automation and AI.

**Negative / trade-offs**
- Some securities context lives only as a reference pointer; users cross-reference the FFS system for substance.
- Every feature touching cases must respect the `is_security` gate.

## Related Documents
- CLAUDE.md §4.1, §4.2, §5, §11.1, §12
- docs/data-guardrails.md; `.claude/skills/fsos-security-audit`
