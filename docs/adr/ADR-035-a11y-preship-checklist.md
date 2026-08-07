# ADR-035 — Accessibility / responsive verification via a manual pre-ship checklist

**Status:** Withdrawn (2026-08-07 — the WCAG-AA pre-ship gating doctrine was removed from the engineering contract; the checklist remains available as an optional reference, not a required gate)
**Date:** 2026-08-03
**Owner:** FSOS Engineering

## Context
P1/P2/P3 shipped with a standing pre-ship gate: **accessibility, responsive behavior, and
screen-reader conformance were verified by INSPECTION only** — no automated harness (`deploy-notes.md`,
`P1-report.md` §5.2). CLAUDE.md §13.1 requires WCAG 2.2 AA on every surface. The question is how to
close that gate. FSOS is a **single-FSA internal tool** (one operator, one deployment); the test
stack is a bespoke Node runner with a Node-only CI (no browser).

## Decision
Close the a11y / responsive / screen-reader prerequisite with a **documented manual pre-ship
checklist**, run **once before each ship**: a keyboard-only tab-through, an **axe browser-extension**
scan (axe DevTools) on each surface, a screen-reader spot-check, and a responsive-breakpoint check.
The checklist lives at **`docs/booking/a11y-preship-checklist.md`**.

**Explicitly do NOT** adopt an automated browser-test platform — no Playwright, no `@axe-core/*`, no
CI browser-test job. The verification is a human, repeatable procedure, not a code dependency.

## Rationale
An automated browser-test platform (Playwright + provisioned browsers + a CI browser job + auth
fixtures for the gated surfaces) is **disproportionate to a one-operator internal system**: it adds a
heavy dependency, ongoing flake/fixture maintenance, and CI fragility (a browser step on the runner)
for a product with a single user and a single deploy target. The **axe browser extension catches the
same serious/critical WCAG failures** an automated axe run would (labels, contrast, ARIA, landmark
and heading structure), and a keyboard tab-through + SR spot-check covers the interaction dimensions a
static scan cannot — all re-runnable by the operator in minutes before ship. The cost/benefit favors
the checklist.

## Alternatives Considered
- **Automated Playwright + axe-core harness (+ eventual CI job).** Rejected: dependency weight, CI
  fragility, and auth-fixture/flake maintenance are not justified for a single-FSA internal tool. (A
  trial harness was prototyped and reverted; the axe extension gives equivalent static coverage
  without the platform.)
- **Lighthouse CI.** Rejected: weaker/flakier a11y assertions; still a browser-CI platform.
- **Leave inspection-only.** Rejected: no concrete, repeatable closure of the §13.1 gate.

## Consequences
**Positive**
- No new dependencies, no CI browser step, no flake/fixture maintenance.
- The gate has a concrete, versioned, repeatable closure procedure the operator owns.
- Covers what static scans miss (keyboard path, focus order, SR announcements).

**Negative / trade-offs**
- Manual — relies on discipline, not enforced by CI; not regression-proof **between** runs (re-run
  before each ship is the mitigation; the checklist is explicit and versioned).
- Visual-regression (pixel diffing) remains a separate, unaddressed concern (out of scope).

## Related Documents
- CLAUDE.md §13.1 (WCAG 2.2 AA), §21 (Definition of Done)
- `docs/booking/a11y-preship-checklist.md` (the checklist)
- `docs/booking/deploy-notes.md` (the pre-ship gate), `docs/booking/P1-report.md` §5.2
