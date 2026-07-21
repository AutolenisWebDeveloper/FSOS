# ADR-001 — Aggregate Root: Agency Partnership

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
FSOS supports a B2B2C referral/wholesale model: a licensed Farmers Financial Services Agent (FSA) partners with Farmers agency owners to reach those agencies' existing clients with life and financial products. The natural pull of most CRM tooling is to make a generic Contact or Deal the center of the data model. That framing does not match how value is actually created here — through *partnerships with agency owners* that produce referral flow, reviews, opportunities, cases, and commissions.

## Decision
The **Agency-Owner Partnership** is the aggregate root of the entire data model. The dependency spine is:
`Agency Partnership → Referral → Household → (Financial) Review → Opportunity → Case → Commission.`
Entities are built and reasoned about in that order. The Financial Review layer is first-class: it is where reviews happen and where opportunities originate. FSOS is not implemented as a generic contact-and-deal CRM.

## Rationale
- The partnership is the unit that generates and governs referral flow; households and opportunities are downstream of it.
- Modeling the partnership as the root keeps ownership, scope, permissions (RLS), and commission attribution coherent from the top down.
- It prevents the system from degrading into an undifferentiated contact database where the agency relationship — the actual growth engine — becomes a mere tag.

## Alternatives Considered
- **Generic Contact as root** — rejected: loses the agency relationship as a first-class entity; commission splits and referral provenance become bolt-ons; RLS scoping gets muddy.
- **Deal/Opportunity as root** — rejected: opportunities are downstream artifacts, not the organizing principle; orphans referrals and reviews.
- **Household as root** — rejected: households belong to referrals that belong to partnerships; making them the root inverts the real dependency and breaks partner-level reporting.

## Consequences
**Positive**
- Clear ownership and RLS scoping from partnership downward.
- Commission attribution and partner performance reporting are natural.
- Build order and permissions follow the real domain.

**Negative / trade-offs**
- More upfront modeling than a generic CRM; contributors must learn the spine before adding entities.
- Legacy/audit docs used flat names (`customers`, `scores`, `commission_cases`); a naming bridge is required (see CLAUDE.md §1).

## Related Documents
- CLAUDE.md §0, §1, §10
- docs/build-order.md, docs/data-guardrails.md
- docs/adr/ADR-010-data-ownership-and-rls.md
