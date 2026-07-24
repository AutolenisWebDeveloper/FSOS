# Slice 6 — Education planning

> Governed by ADR-015 + ADR-016. Small slice — the `education_funding` formula
> shipped in Slice 1; this deepens its inputs, scenarios, and view.

## What shipped
- **Richer education inputs:** added `education_annual_contribution` to the
  Comprehensive plan type and wired it into the orchestrator's `educationFunding`
  call — the projection now credits ongoing contributions, not just a lump sum.
- **Education scenario presets:** `education_fund_more` (+$3k/yr),
  `lower_cost_school` (−$10k/yr cost), `delay_college` (+2 years) — added to
  `SCENARIO_PRESETS` so the scenario builder can test education levers.
- **Education readiness page** `/app/fna/education` — per-plan funding need vs.
  projected savings: inflated cost, capital needed at matriculation, shortfall/
  surplus, funded ratio.

## Tests
`tests/fna-scenarios.test.mjs` extended (now 9): funding-more-reduces-shortfall,
lower-cost-school-reduces-shortfall. `tests/fna-calculate.test.mjs` fixture updated
for the new field so comprehensive completeness stays exact.

## Verification
type-check ✓ · lint ✓ · `npm test` ✓ · RLS proof ✓ (18/18) · build ✓ (education route).
