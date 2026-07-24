# Slice 8 — Command-center consolidation + navigation move

> Governed by ADR-016 + `DESIGN.md`. Built after the engine. One draft PR.

## What shipped
- **Navigation move** (`src/app/(fsa)/layout.tsx`): the FNA entry moved from
  **PIPELINE → OVERVIEW** and was renamed **"FNA Generator" → "AI FNA Command
  Center"**, placed with the other command centers. Every other PIPELINE item
  (Reviews, Opportunities, OPRA Transfers, Cases, Commissions) is unchanged.
- **Consolidated Overview**: `/app/fna` gains a "Planning modules" grid linking
  every workspace (plans, cash-flow, net-worth, retirement, education, protection,
  estate, goals, scenarios, reviews, reports, documents, business-owner, tax-aware,
  assumptions, generate) so nothing is orphaned now that FNA has one sidebar entry.
- **Reviews view** `/app/fna/reviews` — a planning-scoped read over the SAME
  `reviews` tables; each review can start/refresh an FNA. Does **not** replace the
  Pipeline → Reviews page.
- **Business Owner + Tax-Aware plan types** — new **config entries** in the plan-type
  registry (`business_owner_review`, `tax_aware_review`), reusing the same engine +
  data model (no new engine). Their landing pages `/app/fna/business-owner` and
  `/app/fna/tax-aware` filter plans by type and start new ones; tax-aware surfaces
  the `effective_tax_rate` **assumption** (assumptions only — not tax advice).

## Verification
type-check ✓ · lint ✓ · `npm test` ✓ · RLS proof ✓ (18/18) · build ✓
(reviews / business-owner / tax-aware routes compiled).

## Deferred
Advisor workspace (recommendations, formula explorer, cross-plan audit, timeline —
slice 9) · dashboard intelligence on the Executive Dashboard + Command Center
(slice 10).
