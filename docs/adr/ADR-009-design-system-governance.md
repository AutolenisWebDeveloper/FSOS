# ADR-009 — Design-System Governance

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
FSOS spans a public site, six portals, emails, PDFs, and reports, and must hold Fortune-500 fintech quality and Farmers brand consistency across all of them. In an AI-assisted codebase, ad-hoc colors, one-off components, and divergent patterns accumulate quickly and erode both quality and brand.

## Decision
**`DESIGN.md` is the single authoritative source** for design tokens, color, typography, spacing, layout, components, responsive behavior, accessibility, motion, branding, and interaction patterns. No component, page, or feature may introduce a new design pattern, token, or component variant without updating `DESIGN.md` in the same change. Colors/spacing/fonts are never hardcoded — always resolved through tokens. Design conflict order: `CLAUDE.md` → `DESIGN.md` → existing implementation. `CLAUDE.md` references `DESIGN.md` and never restates design decisions.

## Rationale
- One source of truth prevents design drift across many surfaces.
- Token-only styling keeps brand + accessibility (WCAG 2.2 AA) consistent and centrally tunable.
- Separating "how to build" (CLAUDE.md) from "how it looks/behaves" (DESIGN.md) keeps both maintainable.

## Alternatives Considered
- **Design rules inside CLAUDE.md** — rejected: bloats the contract; design and engineering evolve at different rates.
- **Per-portal styling** — rejected: guarantees inconsistency and brand drift.

## Consequences
**Positive**
- Consistent, on-brand, accessible UI; deliberate, reviewable design evolution.

**Negative / trade-offs**
- Design changes require a `DESIGN.md` update in the same PR (intentional friction).

## Related Documents
- CLAUDE.md §17, §18
- DESIGN.md (all); docs/design-system.md, docs/design-audit.md
