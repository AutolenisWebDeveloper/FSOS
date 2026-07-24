# Slice 9 — Advisor workspace + timeline

> Governed by ADR-016 + build instruction §1. Adds migration 062. One draft PR.

## What shipped
- **Recommendations (§1 governance)** — the HUMAN recommendation record. FSOS
  analyzes; the FSA recommends. Migration **062** adds `fna_recommendations` with
  the full Reg-BI capture (objective, facts, assumptions, methodology, alternatives,
  advantages/disadvantages, costs, risks, liquidity, limitations, missing info,
  rationale, reviewer, timestamps), pinned to the FNA version, back-office RLS.
  `product_category` is CATEGORY-only (§1 red line / §4.1 firewall). The system
  **never generates** a recommendation — the FSA authors it.
  - Store: `createRecommendation` / `approveRecommendation` / `listRecommendations`.
  - API: `POST /api/fna/recommendations` (author, Zod-validated), `POST …/[id]/approve`.
  - UI: `/app/fna/recommendations` — author form + approval + recommendation/approval history.
- **Formula explorer** `/app/fna/formulas` — the traceability index: every formula's
  id, version, category, inputs, and a live engine-computed worked example.
- **Cross-plan audit** `/app/fna/audit` — every FNA event across all plans from the
  append-only `audit_log`.
- **Milestone timeline** `/app/fna/timeline` — upcoming reviews due, term-conversion
  windows, and policy renewals derived from real data.
- Overview modules grid extended with all four.

## Tests
`tests/rls-firewall.test.mjs` extended (now **19**): a client sees zero
`fna_recommendations` rows (back-office default-deny, mig 062).

## Verification
type-check ✓ · lint ✓ · `npm test` ✓ · `test:rls` ✓ (19/19) · build ✓
(recommendations API + page, formulas, audit, timeline routes compiled).

## Deferred
Planning intelligence on the existing Executive Dashboard + Command Center (slice 10).
